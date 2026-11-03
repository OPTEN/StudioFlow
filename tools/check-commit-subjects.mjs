// Checks that the subjects of new commits follow Conventional Commits (docs/releasing.md, section 2). release-please
// derives the version and the release notes from the subjects, and a commit pushed straight to main is not covered by
// the pull request title check. The allowed types come from .github/workflows/pr-title.yml.
// Usage: node tools/check-commit-subjects.mjs <base> [head]     (head defaults to HEAD)
//   Checks the commits in <base>..<head>. When <base> is empty, all zeros (new branch), unknown to this clone or not an
//   ancestor of <head> (force push), only the head commit is checked.
// Exit codes: 0 all subjects conform, 1 at least one does not, 2 wrong usage or git failure.
import { execFileSync } from 'node:child_process';
import { createMatcher } from './lib/commit-subjects.mjs';

const [base = '', head = 'HEAD'] = process.argv.slice(2);
if (process.argv.length < 3) {
  console.error('Usage: node tools/check-commit-subjects.mjs <base> [head]');
  process.exit(2);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const succeeds = (...args) => {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
};

try {
  const usable =
    base !== '' &&
    !/^0+$/.test(base) &&
    succeeds('cat-file', '-e', `${base}^{commit}`) &&
    succeeds('merge-base', '--is-ancestor', base, head);
  const range = usable ? [`${base}..${head}`] : ['-1', head];
  const commits = git('log', '--format=%h%x09%s', ...range)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
  const matches = createMatcher();
  const bad = commits.filter(([, subject]) => !matches(subject));

  const scope = usable ? `${base.slice(0, 7)}..${head}` : `${head} only (no usable base)`;
  if (bad.length === 0) {
    console.log(`Commit subjects: ${commits.length} checked (${scope}), all follow Conventional Commits.`);
  } else {
    console.error(`Commit subjects: ${bad.length} of ${commits.length} (${scope}) do not follow Conventional Commits:`);
    for (const [sha, subject] of bad) console.error(`  ${sha} ${subject}`);
    console.error('Expected "type(scope): subject" or "type!: subject"; see docs/releasing.md, section 2.');
    process.exit(1);
  }
} catch (error) {
  console.error(`check-commit-subjects: ${error.message}`);
  process.exit(2);
}
