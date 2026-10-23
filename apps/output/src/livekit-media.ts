/**
 * Entry of the lazily loaded media chunk (`livekit-media-[hash].js`): livekit-client is ~150 KB gzip and not
 * tree-shakable, so the page imports it with `import('./livekit-media')` only after the first frame.
 */
export { LiveKitSourceProvider, MediaSession } from '@studioflow/media-client';
