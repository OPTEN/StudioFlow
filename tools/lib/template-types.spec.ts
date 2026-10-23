import { NgtscProgram, createCompilerHost, readConfiguration } from '@angular/compiler-cli';
import { join } from 'node:path';

/**
 * The typed message layer only pays off if a mistake in a template fails the build. This compiles small components with
 * the Angular compiler and the strict template settings of the apps, and expects the good one to pass and each bad one
 * to fail (spike 1 of issue #6; the fallback of an impure `| t` pipe was not needed).
 */
const directory = join(process.cwd(), 'tools/lib/fixtures/template-types');

function diagnosticsOf(): Map<string, string[]> {
  const { options, rootNames } = readConfiguration(join(directory, 'tsconfig.json'));
  const host = createCompilerHost({ options });
  const program = new NgtscProgram(rootNames, options, host);
  const found = new Map<string, string[]>();
  const all = [...program.getTsSemanticDiagnostics(), ...program.getNgSemanticDiagnostics()];
  for (const diagnostic of all) {
    const file = diagnostic.file?.fileName.split('/').pop() ?? 'unknown';
    const message =
      typeof diagnostic.messageText === 'string'
        ? diagnostic.messageText
        : diagnostic.messageText.messageText;
    found.set(file, [...(found.get(file) ?? []), message]);
  }
  return found;
}

describe('typed messages in Angular templates', () => {
  const diagnostics = diagnosticsOf();

  it('accepts valid keys, parameters, plural counts and template literals', () => {
    expect(diagnostics.get('ok.component.html') ?? []).toEqual([]);
    expect(diagnostics.get('ok.component.ts') ?? []).toEqual([]);
  });

  it.each([
    ['unknown-key', 'an unknown key'],
    ['missing-param', 'a missing parameter'],
    ['wrong-param', 'a parameter the message does not have'],
    ['bad-literal', 'a template literal with a member that has no key'],
  ])('rejects %s (%s)', (name) => {
    const found = diagnostics.get(`${name}.component.html`) ?? [];
    expect(found.length, `${name} must fail to compile`).toBeGreaterThan(0);
  });
}, 120_000);
