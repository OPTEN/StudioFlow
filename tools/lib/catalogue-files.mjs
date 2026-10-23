import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { CATALOGUE_LOCALES, listNamespaces, namespacePrefix } from './catalogue-index.mjs';

/**
 * Loads the catalogue files for the checks. The files only import types, so each one can be transpiled on its own and
 * evaluated without a module system.
 */

/** The messages a catalogue file exports, evaluated. */
export function evaluateCatalogueSource(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function('exports', 'module', outputText)(module.exports, module);
  const values = Object.values(module.exports);
  if (values.length !== 1 || typeof values[0] !== 'object' || values[0] === null) {
    throw new Error('a catalogue file must export exactly one object');
  }
  return values[0];
}

/**
 * Reads all catalogue files of all locales.
 * @returns {Map<string, Map<string, { prefix: string, messages: Record<string, unknown>, file: string }>>}
 *   locale → namespace name → content
 */
export function loadCatalogues(messagesDirectory) {
  const result = new Map();
  for (const locale of CATALOGUE_LOCALES) {
    const directory = join(messagesDirectory, locale);
    const namespaces = new Map();
    for (const name of listNamespaces(directory)) {
      const file = `messages/${locale}/${name}.ts`;
      namespaces.set(name, {
        prefix: namespacePrefix(name),
        messages: evaluateCatalogueSource(readFileSync(join(directory, `${name}.ts`), 'utf8')),
        file,
      });
    }
    result.set(locale, namespaces);
  }
  return result;
}

/** Every `.ts` and `.html` file below `directories` (relative to `root`), skipping the catalogues themselves. */
export function sourceFiles(root, directories) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.angular', 'bin', 'obj'].includes(entry.name)) {
          walk(path);
        }
      } else if (/\.(?:ts|html)$/.test(entry.name)) {
        found.push(path);
      }
    }
  };
  for (const directory of directories) {
    walk(directory);
  }
  return found.sort();
}
