/**
 * Output page entry point (spec 9.3): `/o/{slug}?k=…[&bg=transparent][&debug=1][&latency=1]` renders the program of
 * one production as a 1920 × 1080 stage; `/o/_uhr` is the measurement clock. Kept small: the composition lives in
 * output-app.ts, livekit-client and the optional overlays are loaded lazily after the first frame.
 */
import './styles.css';
import { startClockPage } from './clock-page';
import { resolveRoute } from './config';
import { startInvalidLinkPage, startOutputApp } from './output-app';

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
