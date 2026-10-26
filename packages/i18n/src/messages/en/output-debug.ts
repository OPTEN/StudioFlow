import type { Namespace } from '../../types';

/**
 * The `?debug=1` panel of the output page: state words per connection (`output.debug.<group>.<state>`, looked up by
 * the state names of the hub, the sync and the media session) and the lines of the panel. The units `fps`, `Mbit/s`
 * and `ms` are written by the code.
 */
export const outputDebug = {
  'output.debug.availability.live': 'live',
  'output.debug.availability.lost': 'freeze frame',
  'output.debug.availability.pending': 'no picture',

  'output.debug.broadcast.ended': 'ended',
  'output.debug.broadcast.live': 'live',
  'output.debug.broadcast.standby': 'ready',

  'output.debug.buffer': 'Buffer {value}',
  'output.debug.canvas': 'Canvas {size} · {format} · {resolution}',
  'output.debug.canvasUnknown': 'Canvas unknown',
  'output.debug.connections': 'Hub {hub} · Sync {sync}',

  'output.debug.hub.connected': 'connected',
  'output.debug.hub.connecting': 'connecting…',
  'output.debug.hub.idle': 'ready',
  'output.debug.hub.reconnecting': 'reconnecting',
  'output.debug.hub.stopped': 'stopped',
  'output.debug.hub.unauthorized': 'no access',

  'output.debug.latency': 'Latency ≈ {latency} · Renderer {fps} fps',
  'output.debug.livekit': 'LiveKit {state}',
  'output.debug.livekitLoading': 'loading…',
  'output.debug.loss': 'Loss {value}',

  'output.debug.media.connected': 'connected',
  'output.debug.media.connecting': 'connecting…',
  'output.debug.media.idle': 'ready',
  'output.debug.media.reconnecting': 'reconnecting',
  'output.debug.media.removed': 'removed',
  'output.debug.media.replaced': 'replaced',
  'output.debug.media.stopped': 'stopped',
  'output.debug.media.unauthorized': 'no access',
  'output.debug.media.waiting': 'waiting to retry',

  'output.debug.noSources': 'No camera or screen source in the picture',
  'output.debug.productionUnknown': 'Unknown production',
  'output.debug.revision': 'Revision {revision} · Broadcast {state}',
  'output.debug.scene': 'Scene “{name}”',
  'output.debug.sceneNone': 'no scene',
  'output.debug.sourceFallback': 'Source',

  'output.debug.sync.connecting': 'connecting…',
  'output.debug.sync.live': 'up to date',
  'output.debug.sync.offline': 'offline, last state',
  'output.debug.sync.syncing': 'syncing',
  'output.debug.sync.unauthorized': 'no access',
} as const satisfies Namespace<'output.debug'>;
