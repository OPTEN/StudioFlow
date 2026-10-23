import { splitSource, syntaxFor, withoutComments } from './tokenize.mjs';

describe('splitSource (TypeScript)', () => {
  it('separates comments from string literals and keeps line numbers', () => {
    const source = [
      'const a = "Hallo"; // Kommentar',
      'const b = 1; /* block',
      "second line */ const c = 'x';",
    ].join('\n');
    const { comments, strings } = splitSource(source, 'ts');
    expect(comments.split('\n').map((line) => line.trim())).toEqual([
      '// Kommentar',
      '/* block',
      'second line */',
    ]);
    expect(strings.split('\n').map((line) => line.trim())).toEqual(['Hallo', '', 'x']);
    expect(comments).toHaveLength(source.length);
    expect(strings).toHaveLength(source.length);
  });

  it('does not take a comment marker inside a string for a comment', () => {
    const { comments, strings } = splitSource('const url = "http://example.com"; // real', 'ts');
    expect(comments.trim()).toBe('// real');
    expect(strings.trim()).toBe('http://example.com');
  });

  it('handles escaped quotes', () => {
    const { strings } = splitSource('const s = \'it\\\'s fine\'; const t = "say \\"hi\\"";', 'ts');
    expect(strings).toContain("it\\'s fine");
    expect(strings).toContain('say \\"hi\\"');
  });

  it('reads template literals including the strings inside ${ }', () => {
    const { strings } = splitSource('const s = `a ${ cond ? "yes" : "no" } b ${x}`;', 'ts');
    expect(strings).toContain('a ');
    expect(strings).toContain('yes');
    expect(strings).toContain('no');
    expect(strings).toContain(' b ');
    expect(strings).not.toContain('cond');
  });

  it('keeps multi-line templates, as Angular inline templates are', () => {
    const { strings } = splitSource('@Component({ template: `\n<p>Hello</p>\n` })', 'ts');
    expect(strings).toContain('<p>Hello</p>');
  });

  it('skips regular expression literals with quotes in them', () => {
    const { strings, comments } = splitSource(
      'const r = /["\'/]+/g; const s = "after"; // note',
      'ts',
    );
    expect(strings.trim()).toBe('after');
    expect(comments.trim()).toBe('// note');
  });

  it('tells a division from a regular expression', () => {
    const { strings } = splitSource('const half = total / 2; const s = "x" / 2;', 'ts');
    expect(strings.trim()).toBe('x');
  });
});

describe('splitSource (C#)', () => {
  it('treats /// documentation as a comment', () => {
    const { comments, strings } = splitSource(
      '/// <summary>Doc</summary>\npublic const string A = "text";',
      'cs',
    );
    expect(comments.split('\n')[0]).toBe('/// <summary>Doc</summary>');
    expect(strings.trim()).toBe('text');
  });

  it('reads interpolated, verbatim and raw strings', () => {
    const source = [
      'var a = $"Scene {name}";',
      'var b = @"say ""hi""";',
      'var c = """',
      'raw text',
      '""";',
    ].join('\n');
    const { strings } = splitSource(source, 'cs');
    expect(strings).toContain('Scene {name}');
    expect(strings).toContain('say ""hi""');
    expect(strings).toContain('raw text');
  });

  it('ignores char literals', () => {
    const { strings } = splitSource('var c = \'"\'; var s = "ok";', 'cs');
    expect(strings.trim()).toBe('ok');
  });
});

describe('withoutComments (HTML)', () => {
  it('blanks <!-- --> and keeps everything else', () => {
    const result = withoutComments('<p>a</p>\n<!-- hidden\nlines -->\n<p>b</p>', 'html');
    expect(result.split('\n')[0]).toBe('<p>a</p>');
    expect(result.split('\n')[1].trim()).toBe('');
    expect(result.split('\n')[2].trim()).toBe('');
    expect(result.split('\n')[3]).toBe('<p>b</p>');
  });
});

describe('syntaxFor', () => {
  it('maps extensions to a syntax', () => {
    expect(syntaxFor('ts')).toBe('ts');
    expect(syntaxFor('cs')).toBe('cs');
    expect(syntaxFor('scss')).toBe('scss');
    expect(syntaxFor('css')).toBe('scss');
    expect(syntaxFor('html')).toBe('html');
    expect(syntaxFor('sh')).toBeNull();
  });
});
