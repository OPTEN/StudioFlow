import type { Locale } from '@studioflow/i18n';

/** "studioflow.example.com/o/webinar?k=••••••": without scheme and with the key masked. */
export function maskOutputUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/([?&]k=)[^&#]*/, '$1••••••');
}

/** How the output page of a link shows itself: the flags of its URL (`bg`, `audio`, `lang`). */
export interface OutputLinkOptions {
  readonly transparent: boolean;
  readonly sound: boolean;
  readonly language: Locale | 'auto';
}

/** A link as the API gives it: black background, sound on, the language of the browser that opens it. */
export const DEFAULT_LINK_OPTIONS: OutputLinkOptions = {
  transparent: false,
  sound: true,
  language: 'auto',
};

/**
 * The URL of a link with its display flags: a transparent background (`bg=transparent`), no sound (`audio=off`) and
 * the language of the page's own messages (`lang=`). The flags are appended, the link itself stays as it is.
 */
export function outputLinkUrl(url: string, options: OutputLinkOptions): string {
  const flags = new URLSearchParams();
  if (options.transparent) {
    flags.set('bg', 'transparent');
  }
  if (!options.sound) {
    flags.set('audio', 'off');
  }
  if (options.language !== 'auto') {
    flags.set('lang', options.language);
  }
  const query = flags.toString();
  return query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url;
}
