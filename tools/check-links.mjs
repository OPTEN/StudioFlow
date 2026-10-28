// Checks the links of all tracked Markdown files: relative paths must exist, `#anchors` must match a heading of the
// target file, and links to this repository on GitHub must point to OPTEN/StudioFlow. External sites are not fetched.
// Usage: node tools/check-links.mjs     (exit 1 when a link is broken)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/** GitHub's slug of a heading: lower case, punctuation removed, spaces to hyphens. */
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    const seen = new Map();
    const set = new Set();
    for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      const s = slug(m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
      const n = seen.get(s) ?? 0;
      seen.set(s, n + 1);
      set.add(n === 0 ? s : `${s}-${n}`);
    }
    for (const m of text.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) set.add(m[1]);
    anchorCache.set(file, set);
  }
  return anchorCache.get(file);
}

const problems = [];
for (const rel of files) {
  const file = path.join(root, rel);
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, (b) => '\n'.repeat(b.split('\n').length - 1));
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/`[^`]*`/g, '');
    for (const m of code.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const target = m[1];
      const where = `${rel}:${i + 1}`;
      if (/^https?:\/\//.test(target)) {
        const gh = target.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/i);
        if (gh && gh[1].toLowerCase() === 'opten' && !/^StudioFlow$/i.test(gh[2]) && /flowstudio/i.test(gh[2]))
          problems.push(`${where}: GitHub link to the former name: ${target}`);
        continue;
      }
      if (/^(mailto:|tel:)/.test(target)) continue;
      const [rawPath, anchor] = target.split('#');
      const decoded = decodeURI(rawPath);
      const resolved = decoded === '' ? file : path.resolve(path.dirname(file), decoded);
      if (!existsSync(resolved)) {
        problems.push(`${where}: missing target ${target}`);
        continue;
      }
      if (anchor && statSync(resolved).isFile() && resolved.endsWith('.md') && !anchorsOf(resolved).has(anchor.toLowerCase()))
        problems.push(`${where}: no heading for anchor #${anchor} in ${path.relative(root, resolved)}`);
    }
  });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} broken link(s) in ${files.length} Markdown files.`);
  process.exit(1);
}
console.log(`Links OK in ${files.length} Markdown files.`);
