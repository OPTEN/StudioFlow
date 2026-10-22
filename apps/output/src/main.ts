/**
 * Output page entry point. Renders the program of one production as a 16:9 page for the proxy.
 * See docs/architecture/implementation-spec.md, section 9.3.
 */
const root = document.getElementById('output');
if (root) {
  root.dataset['state'] = 'booting';
}
