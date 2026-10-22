/**
 * Opt-in test hooks (spec 12, GAP-15): read-only state views on `window` for the E2E tests. They exist only when
 * `localStorage['flowstudio.testHooks']` is exactly `'1'` (E2E sets it with an init script before the app loads); a
 * normal phone or laptop never gets a global debug object.
 */

/** The localStorage key of the opt-in flag. */
export const TEST_HOOKS_FLAG = 'flowstudio.testHooks';

/** True when the flag of `view` is set to `'1'`. Never throws: blocked or unavailable storage means off. */
export function testHooksEnabled(view: Window | null | undefined): boolean {
  try {
    return view?.localStorage?.getItem(TEST_HOOKS_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * Defines `view[name]` as a frozen, non-writable, non-enumerable object (getters read the live state) and returns the
 * function that removes it again. Without a window nothing happens.
 */
export function exposeTestHook(
  view: Window | null | undefined,
  name: string,
  hook: object,
): () => void {
  if (!view) {
    return () => undefined;
  }
  const frozen = Object.freeze(hook);
  Object.defineProperty(view, name, {
    value: frozen,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return () => {
    if (Object.getOwnPropertyDescriptor(view, name)?.value === frozen) {
      Reflect.deleteProperty(view, name);
    }
  };
}
