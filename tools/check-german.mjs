#!/usr/bin/env node
/**
 * Definition of done of issue #6: finds German UI text outside the German translation files.
 *
 *   node tools/check-german.mjs [--root <dir>] [--paths <p>…] [--json] [--comments] [--staged]
 *                               [--allowlist <dir>] [--no-allowlist] [--summary] [--recall]
 *
 * Exit codes: 0 clean, 1 findings, 2 usage error or an allowlist entry that matches no file.
 * The rules and what is scanned are described in docs/i18n.md and implemented in tools/lib/german.mjs and scan.mjs.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllowlist, unusedEntries } from './lib/allowlist.mjs';
import { filterPaths, listFiles, scanFiles } from './lib/scan.mjs';

const USAGE =
  'usage: node tools/check-german.mjs [--root <dir>] [--paths <p>…] [--json] [--comments] [--staged] ' +
  '[--allowlist <dir>] [--no-allowlist] [--summary] [--recall]';

function parseArguments(argv) {
  const options = {
    root: null,
    paths: [],
    json: false,
    comments: false,
    staged: false,
    allowlist: null,
    noAllowlist: false,
    summary: false,
    recall: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    switch (argument) {
      case '--root':
      case '--allowlist':
        if (argv[i + 1] === undefined) {
          throw new Error(`${argument} needs a directory`);
        }
        options[argument === '--root' ? 'root' : 'allowlist'] = argv[++i];
        break;
      case '--paths':
        while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
          options.paths.push(argv[++i]);
        }
        if (options.paths.length === 0) {
          throw new Error('--paths needs at least one path');
        }
        break;
      case '--json':
        options.json = true;
        break;
      case '--comments':
        options.comments = true;
        break;
      case '--staged':
        options.staged = true;
        break;
      case '--no-allowlist':
        options.noAllowlist = true;
        break;
      case '--summary':
        options.summary = true;
        break;
      case '--recall':
        options.recall = true;
        break;
      default:
        throw new Error(`unknown argument ${argument}`);
    }
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`check-german: ${error.message}\n${USAGE}`);
    return 2;
  }

  const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
  const root = resolve(options.root ?? repositoryRoot);
  if (!existsSync(root)) {
    console.error(`check-german: ${root} does not exist`);
    return 2;
  }
  const allowlistDirectory = options.allowlist
    ? resolve(options.allowlist)
    : join(options.root ? root : repositoryRoot, 'tools', 'german-allowlist');
  let allowlist = [];
  if (!options.noAllowlist) {
    try {
      allowlist = loadAllowlist(allowlistDirectory);
    } catch (error) {
      console.error(`check-german: ${error.message}`);
      return 2;
    }
  }

  const allFiles = listFiles(root, { staged: options.staged });
  const files = filterPaths(allFiles, options.paths);
  if (options.recall) {
    return reportRecall(root, files, allowlist);
  }
  const findings = scanFiles({ root, files, comments: options.comments, allowlist });
  const errors = findings.filter((finding) => finding.severity === 'error');

  if (options.json) {
    console.log(JSON.stringify({ files: files.length, findings }, null, 2));
  } else {
    for (const finding of errors) {
      console.log(
        `${finding.file}:${finding.line}  ${finding.rule}  ${finding.detail}  |  ${finding.text.slice(0, 120)}`,
      );
    }
    const flaggedFiles = new Set(errors.map((finding) => finding.file));
    const infos = findings.length - errors.length;
    console.log(
      `check-german: ${files.length} files scanned, ${flaggedFiles.size} with German (${errors.length} findings` +
        `${infos > 0 ? `, ${infos} info in test data` : ''})${options.comments ? ' [comments]' : ''}`,
    );
    if (options.summary) {
      console.log(JSON.stringify(summarise(errors), null, 2));
    }
  }

  // A stale allowlist entry hides nothing; it is only reported for a full scan (a subset leaves most unused).
  if (options.paths.length === 0 && !options.staged && !options.comments) {
    const unused = unusedEntries(allowlist);
    if (unused.length > 0) {
      for (const entry of unused) {
        console.error(
          `check-german: allowlist entry matches no file: ${entry.path} (${entry.file})`,
        );
      }
      return 2;
    }
  }
  return errors.length > 0 ? 1 : 0;
}

/**
 * Recall run: files with German of any kind (UI text, comments, test data) per area, which is what the issue counted
 * on `main`. Both tiers are combined; info findings in test data count.
 */
function reportRecall(root, files, allowlist) {
  const findings = [
    ...scanFiles({ root, files, comments: false, allowlist }),
    ...scanFiles({ root, files, comments: true, allowlist }),
  ];
  console.log(JSON.stringify(summarise(findings), null, 2));
  return 0;
}

/** Flagged files per area, for the recall run of the foundation. */
function summarise(errors) {
  const areaOf = (file) => {
    if (file.startsWith('apps/studio/')) return 'studio';
    if (file.startsWith('apps/sender/')) return 'sender';
    if (file.startsWith('apps/api/')) return 'api';
    if (file.startsWith('apps/output/')) return 'output';
    if (file.startsWith('packages/')) return 'packages';
    if (file.startsWith('tests/')) return 'tests';
    if (file.startsWith('docs/') || file.startsWith('plan/') || file.startsWith('prototype/'))
      return 'docs';
    if (/^(?:[A-Z]+\.md)$/.test(file)) return 'docs';
    if (
      /\.(?:sh|ps1|psm1)$/.test(file) ||
      file.startsWith('infra/') ||
      /^(?:\.env\.example|docker-compose.*\.yml)$/.test(file) ||
      file.startsWith('tools/')
    )
      return 'ops';
    return 'other';
  };
  const perArea = {};
  for (const file of new Set(errors.map((finding) => finding.file))) {
    const area = areaOf(file);
    perArea[area] = (perArea[area] ?? 0) + 1;
  }
  return perArea;
}

process.exitCode = main();
