/**
 * Splits source text into comments and string literals, for the German check.
 *
 * Both results keep the length and the line breaks of the input, with every other character replaced by a space,
 * so a finding in them has the line and column of the original file.
 */

/** Comment syntax per language family. */
const SYNTAX = {
  /** TypeScript: line and block comments, three quote styles, template literals and regular expressions. */
  ts: { line: ['//'], block: [['/*', '*/']], quotes: ["'", '"', '`'], regex: true, template: true },
  scss: { line: ['//'], block: [['/*', '*/']], quotes: ["'", '"'], regex: false, template: false },
  /** C#: line and block comments (also the triple-slash form), plain, verbatim, interpolated and raw strings. */
  cs: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], regex: false, template: false },
  /** HTML and Angular templates: only `<!-- -->` is a comment, there are no string literals to isolate. */
  html: { line: [], block: [['<!--', '-->']], quotes: [], regex: false, template: false },
};

/** Which syntax a file extension uses; `null` means the file has no comments to strip. */
export function syntaxFor(extension) {
  switch (extension) {
    case 'ts':
      return 'ts';
    case 'scss':
    case 'css':
      return 'scss';
    case 'cs':
      return 'cs';
    case 'html':
      return 'html';
    default:
      return null;
  }
}

function blank(char) {
  return char === '\n' || char === '\r' ? char : ' ';
}

/** True when a `/` at this position starts a regular expression (TypeScript), judged by the previous token. */
function startsRegex(text, index) {
  let i = index - 1;
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) {
    i -= 1;
  }
  if (i < 0) {
    return true;
  }
  const previous = text[i];
  if (/[\w$)\]}'"`]/.test(previous)) {
    // After an identifier, number, closing bracket or string a slash divides, except after a few keywords.
    const word = /[\w$]+$/.exec(text.slice(Math.max(0, i - 12), i + 1))?.[0] ?? '';
    return [
      'return',
      'typeof',
      'case',
      'in',
      'of',
      'delete',
      'void',
      'throw',
      'new',
      'else',
    ].includes(word);
  }
  return true;
}

/**
 * Separates comments from string literals.
 * @param {string} text
 * @param {'ts' | 'scss' | 'cs' | 'html'} syntaxName
 * @returns {{ comments: string, strings: string }}
 */
export function splitSource(text, syntaxName) {
  const syntax = SYNTAX[syntaxName];
  const comments = Array.from(text, blank);
  const strings = Array.from(text, blank);
  const length = text.length;
  /** Stack of template literal contexts: brace depth inside `${ }` per open template. */
  const templates = [];
  let i = 0;

  const copy = (target, from, to) => {
    for (let k = from; k < to; k++) {
      target[k] = text[k];
    }
  };

  const readQuoted = (start, quote, { verbatim = false, keep = true } = {}) => {
    // Returns the index after the closing quote; the content goes to `strings`.
    let k = start + 1;
    while (k < length) {
      const char = text[k];
      if (verbatim && char === quote && text[k + 1] === quote) {
        k += 2;
        continue;
      }
      if (!verbatim && char === '\\') {
        k += 2;
        continue;
      }
      if (char === quote) {
        break;
      }
      if (char === '\n' && !verbatim && quote !== '`') {
        break;
      }
      k += 1;
    }
    if (keep) {
      copy(strings, start + 1, Math.min(k, length));
    }
    return k + 1;
  };

  while (i < length) {
    const char = text[i];
    const inTemplateCode = templates.length > 0 && templates[templates.length - 1] >= 0;

    // Inside a template literal text (not inside ${ }).
    if (templates.length > 0 && templates[templates.length - 1] === -1) {
      if (char === '\\') {
        copy(strings, i, Math.min(i + 2, length));
        i += 2;
      } else if (char === '`') {
        templates.pop();
        i += 1;
      } else if (char === '$' && text[i + 1] === '{') {
        templates[templates.length - 1] = 0;
        i += 2;
      } else {
        strings[i] = char;
        i += 1;
      }
      continue;
    }

    // Line comments.
    const lineStart = syntax.line.find((marker) => text.startsWith(marker, i));
    if (lineStart) {
      let end = text.indexOf('\n', i);
      if (end === -1) {
        end = length;
      }
      copy(comments, i, end);
      i = end;
      continue;
    }

    // Block comments.
    const block = syntax.block.find(([open]) => text.startsWith(open, i));
    if (block) {
      const close = text.indexOf(block[1], i + block[0].length);
      const end = close === -1 ? length : close + block[1].length;
      copy(comments, i, end);
      i = end;
      continue;
    }

    if (syntaxName === 'cs') {
      if (text.startsWith('"""', i)) {
        const close = text.indexOf('"""', i + 3);
        const end = close === -1 ? length : close;
        copy(strings, i + 3, end);
        i = close === -1 ? length : close + 3;
        continue;
      }
      const prefixed = /^(?:\$@|@\$|@|\$)"/.exec(text.slice(i, i + 3));
      if (prefixed) {
        const verbatim = prefixed[0].includes('@');
        i = readQuoted(i + prefixed[0].length - 1, '"', { verbatim });
        continue;
      }
    }

    if (syntax.quotes.includes(char)) {
      if (char === '`' && syntax.template) {
        templates.push(-1);
        i += 1;
        continue;
      }
      if (syntaxName === 'cs' && char === "'") {
        // A char literal is one character or an escape; never a string worth checking.
        i = readQuoted(i, "'", { keep: false });
        continue;
      }
      i = readQuoted(i, char);
      continue;
    }

    if (syntax.regex && char === '/' && startsRegex(text, i)) {
      let k = i + 1;
      let inClass = false;
      while (k < length && text[k] !== '\n') {
        if (text[k] === '\\') {
          k += 2;
          continue;
        }
        if (text[k] === '[') {
          inClass = true;
        } else if (text[k] === ']') {
          inClass = false;
        } else if (text[k] === '/' && !inClass) {
          break;
        }
        k += 1;
      }
      i = k + 1;
      continue;
    }

    // Braces close a ${ } expression of a template literal.
    if (templates.length > 0 && inTemplateCode) {
      if (char === '{') {
        templates[templates.length - 1] += 1;
      } else if (char === '}') {
        if (templates[templates.length - 1] === 0) {
          templates[templates.length - 1] = -1;
        } else {
          templates[templates.length - 1] -= 1;
        }
      }
    }
    i += 1;
  }

  return { comments: comments.join(''), strings: strings.join('') };
}

/** Text with comments blanked out, everything else as it is (HTML templates). */
export function withoutComments(text, syntaxName) {
  const { comments } = splitSource(text, syntaxName);
  return Array.from(text, (char, index) =>
    comments[index].trim() === '' ? char : blank(char),
  ).join('');
}
