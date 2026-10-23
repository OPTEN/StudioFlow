import type { Locale } from './locales';

/** A message that could not be rendered as written. */
export interface I18nProblem {
  /** `key`: no catalogue has the key; `param`: the message has a `{name}` the caller did not pass. */
  readonly kind: 'key' | 'param';
  readonly key: string;
  readonly locale: Locale;
  /** The missing parameter name for `kind: 'param'`. */
  readonly param?: string;
}

export type ProblemHandler = (problem: I18nProblem) => void;

const reported = new Set<string>();
const missing = new Set<string>();

/** Reports each distinct problem once with `console.error`. */
const logOnce: ProblemHandler = (problem) => {
  const id = `${problem.kind}:${problem.key}:${problem.param ?? ''}`;
  if (reported.has(id)) {
    return;
  }
  reported.add(id);
  console.error(
    problem.kind === 'key'
      ? `[i18n] Missing message key "${problem.key}" (${problem.locale}).`
      : `[i18n] Message "${problem.key}" (${problem.locale}) needs the parameter "${problem.param}".`,
  );
};

let handler: ProblemHandler | null = logOnce;

/** Records a problem for tests and hands it to the handler (default: one `console.error` per problem). */
export function reportProblem(problem: I18nProblem): void {
  if (problem.kind === 'key') {
    missing.add(problem.key);
  }
  handler?.(problem);
}

/** Replaces the default `console.error` reporting; `null` silences it. */
export function setMissingHandler(next: ProblemHandler | null): void {
  handler = next;
}

/** Keys that were asked for and found in no catalogue since the last reset (for tests). */
export function missingKeys(): readonly string[] {
  return [...missing];
}

/** Forgets recorded problems and restores the default handler. */
export function resetDiagnostics(): void {
  missing.clear();
  reported.clear();
  handler = logOnce;
}
