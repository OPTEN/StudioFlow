// Conventional Commits check for commit subjects, shared by tools/check-commit-subjects.mjs and its unit test.
// The allowed types are read from .github/workflows/pr-title.yml (the `types:` list of the pull request title check),
// so a squash-merged pull request title and a commit pushed straight to main are judged by the same list.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const prTitleWorkflow = path.join(root, '.github', 'workflows', 'pr-title.yml');

/** The types of the `types: |` block of pr-title.yml (one per line, indented, up to the next key). */
export function readAllowedTypes(yaml = readFileSync(prTitleWorkflow, 'utf8')) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*types:\s*\|\s*$/.test(line));
  if (start === -1) throw new Error('No "types: |" block found in .github/workflows/pr-title.yml');
  const keyIndent = lines[start].search(/\S/);
  const types = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (line.search(/\S/) <= keyIndent) break;
    types.push(line.trim());
  }
  if (types.length === 0) throw new Error('The "types" block of pr-title.yml is empty');
  return types;
}

/** Builds the matcher: `type(scope)!: subject`, or a subject git generates itself (`Merge ...`, `Revert "..."`). */
export function createMatcher(types = readAllowedTypes()) {
  const conventional = new RegExp(String.raw`^(?:${types.join('|')})(?:\([^()\s][^()]*\))?!?: \S`);
  const generated = /^(?:Merge (?:branch|pull request|remote-tracking branch|tag|commit) .+|Revert ".+")$/;
  return (subject) => conventional.test(subject) || generated.test(subject);
}
