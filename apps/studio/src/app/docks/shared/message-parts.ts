/** Mark that stands in for a value while a message is cut in two (a control character no message contains). */
const MARK = '\u0001';

/** A message cut around one value, so that the value can sit in its own element (for example mono digits). */
export interface MessageParts {
  readonly before: string;
  readonly after: string;
}

/**
 * Cuts a message at the place where a value belongs. `render` builds the message with the given mark instead of the
 * value, for example `(mark) => t('regie.pairing.phone.valid', { time: mark })`; the template then writes
 * `{{ parts.before }}<span class="u-mono">{{ time }}</span>{{ parts.after }}`. The word order stays with the
 * translation, so no sentence is put together from fragments.
 */
export function messageParts(render: (mark: string) => string): MessageParts {
  const text = render(MARK);
  const index = text.indexOf(MARK);
  return index < 0
    ? { before: text, after: '' }
    : { before: text.slice(0, index), after: text.slice(index + 1) };
}
