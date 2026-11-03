import { createMatcher, readAllowedTypes } from './commit-subjects.mjs';

const matches = createMatcher();

describe('commit subjects', () => {
  it('reads the types of the pull request title workflow', () => {
    expect(readAllowedTypes()).toEqual(
      expect.arrayContaining(['feat', 'fix', 'perf', 'revert', 'docs', 'test', 'refactor', 'build', 'ci', 'chore', 'style']),
    );
  });

  it('stops the types list at the next key', () => {
    const yaml = ['with:', '  types: |', '    feat', '    fix', '', '    chore', '  scope: x', '    other'].join('\n');
    expect(readAllowedTypes(yaml)).toEqual(['feat', 'fix', 'chore']);
  });

  it.each([
    'feat: add light mode',
    'fix(api): keep the login after an API restart',
    'feat!: rename the environment variables',
    'feat(api)!: drop the v1 endpoint',
    'ci: check commit subjects on pushes to main (#99)',
    'chore(main): release 0.1.1 (#89)',
    'chore(deps): update postgres to 17.12',
    'Merge branch "main" into feature',
    'Merge pull request #5 from OPTEN/x',
    'Revert "feat: add light mode"',
  ])('accepts %j', (subject) => {
    expect(matches(subject)).toBe(true);
  });

  it.each([
    '',
    'Update readme',
    'fixed the login',
    'Feat: capitalised type',
    'feature: unknown type',
    'feat:no space',
    'feat: ',
    'feat(): empty scope',
    'feat(unclosed: scope',
    'WIP',
    'Merge',
    'Revert the thing',
  ])('rejects %j', (subject) => {
    expect(matches(subject)).toBe(false);
  });
});
