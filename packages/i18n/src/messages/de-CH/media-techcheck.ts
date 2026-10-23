import type { Translation } from '../../types';
import type { mediaTechcheck as en } from '../en/media-techcheck';

export const mediaTechcheck: Translation<typeof en> = {
  'media.techcheck.camera.lowRes': 'Kamera: nur {width} × {height}.',
  'media.techcheck.camera.lowResFps': 'Kamera: nur {width} × {height} bei {fps} fps.',
  'media.techcheck.camera.noPicture': 'Kamera: liefert kein Bild.',
  'media.techcheck.network.latency': 'Netzwerk: hohe Latenz ({rtt} ms).',
  'media.techcheck.network.latencyAndLoss':
    'Netzwerk: hohe Latenz ({rtt} ms), {lost} von {total} Messungen ohne Antwort.',
  'media.techcheck.network.loss': 'Netzwerk: {lost} von {total} Messungen ohne Antwort.',
  'media.techcheck.network.unreachable': 'Netzwerk: Server nicht zuverlässig erreichbar.',
  'media.techcheck.upload.failed': 'Upload: Test fehlgeschlagen.',
  'media.techcheck.upload.slow': 'Upload: nur {rate} Mbit/s (empfohlen ab {recommended} Mbit/s).',
  'media.techcheck.upload.timeout': 'Upload: Zeitüberschreitung (über {seconds} s).',
};
