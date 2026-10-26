/**
 * Output page entry point (spec 9.3): `/o/{slug}?k=…[&bg=transparent][&debug=1][&latency=1][&lang=de-CH]` renders the
 * program of one production as a stage of the size of its canvas (1920 × 1080 by default); `/o/_clock` is the
 * measurement clock. Kept small: the composition lives in
 * output-app.ts, livekit-client and the optional overlays are loaded lazily after the first frame.
 */
import './styles.css';
import { initLocale, parseLocaleTag } from '@studioflow/i18n';
import { startClockPage } from './clock-page';
import { resolveRoute } from './config';
import { startInvalidLinkPage, startOutputApp } from './output-app';

// The page has no language setting and ignores the one of the Regie: `?lang=` wins, then the browser language.
initLocale({
  setting: parseLocaleTag(new URLSearchParams(window.location.search).get('lang')) ?? 'auto',
  storage: null,
});

const root = document.getElementById('output');
if (root) {
  const route = resolveRoute(window, import.meta.env.BASE_URL);
  switch (route.kind) {
    case 'clock':
      startClockPage(document, root);
      break;
    case 'output':
      startOutputApp(route, root);
      break;
    case 'invalid':
      startInvalidLinkPage(root, route.flags);
      break;
  }
}
