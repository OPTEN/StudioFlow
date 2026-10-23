/**
 * Small DOM helpers. All styles are inline (no stylesheet), so the renderer works unchanged inside Angular components
 * with any view encapsulation and on the plain output page. Class names (`sf-r-*`) only label the elements.
 */

/** A set of CSS properties (kebab-case names, as for `style.setProperty`). */
export type StyleMap = Readonly<Record<string, string>>;

/** Absolutely positioned box covering its (positioned) parent. */
export const FILL: StyleMap = {
  position: 'absolute',
  left: '0',
  top: '0',
  width: '100%',
  height: '100%',
};

/** Last value written per element and property, so repeated renders do not touch unchanged styles. */
const writtenStyles = new WeakMap<HTMLElement, Map<string, string>>();

/** Writes a style property only when it differs from the last value written through this helper ('' removes it). */
export function setStyle(element: HTMLElement, property: string, value: string): void {
  let written = writtenStyles.get(element);
  if (!written) {
    written = new Map();
    writtenStyles.set(element, written);
  }
  if (written.get(property) === value) {
    return;
  }
  written.set(property, value);
  if (value === '') {
    element.style.removeProperty(property);
  } else {
    element.style.setProperty(property, value);
  }
}

/** Writes several style properties with {@link setStyle}. */
export function setStyles(element: HTMLElement, styles: StyleMap): void {
  for (const [property, value] of Object.entries(styles)) {
    setStyle(element, property, value);
  }
}

/** Creates an element with a class name and initial styles. */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  styles: StyleMap = {},
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.className = className;
  setStyles(element, styles);
  return element;
}

/** Sets the text of an element only when it changed. */
export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

/** Shows or hides an element (`display: none`) without forgetting its layout styles. */
export function setVisible(element: HTMLElement, visible: boolean, display = 'block'): void {
  setStyle(element, 'display', visible ? display : 'none');
}

/** Formats a canvas-pixel length. */
export function px(value: number): string {
  return `${value}px`;
}
