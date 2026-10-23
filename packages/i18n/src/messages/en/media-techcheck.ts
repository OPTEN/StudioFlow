import type { Namespace } from '../../types';

/**
 * The problems the tech check of `@studioflow/media-client` reports. Rendered by the sender in the active language;
 * the wire `note` is an English summary built from the same messages with `tFor('en')`.
 */
export const mediaTechcheck = {
  'media.techcheck.camera.lowRes': 'Camera: only {width} × {height}.',
  'media.techcheck.camera.lowResFps': 'Camera: only {width} × {height} at {fps} fps.',
  'media.techcheck.camera.noPicture': 'Camera: delivers no picture.',
  'media.techcheck.network.latency': 'Network: high latency ({rtt} ms).',
  'media.techcheck.network.latencyAndLoss':
    'Network: high latency ({rtt} ms), {lost} of {total} measurements got no answer.',
  'media.techcheck.network.loss': 'Network: {lost} of {total} measurements got no answer.',
  'media.techcheck.network.unreachable': 'Network: server not reliably reachable.',
  'media.techcheck.upload.failed': 'Upload: test failed.',
  'media.techcheck.upload.slow':
    'Upload: only {rate} Mbit/s (recommended from {recommended} Mbit/s).',
  'media.techcheck.upload.timeout': 'Upload: timed out (over {seconds} s).',
} as const satisfies Namespace<'media.techcheck'>;
