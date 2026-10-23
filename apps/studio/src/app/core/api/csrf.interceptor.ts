import type { HttpInterceptorFn } from '@angular/common/http';

/** Header the API requires on every cookie-authenticated unsafe request (spec 5, CSRF). */
export const CSRF_HEADER = 'X-StudioFlow';
/** Value of {@link CSRF_HEADER}. */
export const CSRF_HEADER_VALUE = '1';

const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** True for relative URLs and absolute URLs on the page's own origin (the header never leaves the origin). */
export function isSameOrigin(url: string, origin = globalThis.location?.origin ?? ''): boolean {
  if (!/^[a-z][a-z\d+\-.]*:/i.test(url) && !url.startsWith('//')) {
    return true;
  }
  try {
    return new URL(url, origin || undefined).origin === origin;
  } catch {
    return false;
  }
}

/** Adds `X-StudioFlow: 1` to POST, PUT, PATCH and DELETE requests to the own origin. */
export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase()) || !isSameOrigin(request.url)) {
    return next(request);
  }
  return next(request.clone({ setHeaders: { [CSRF_HEADER]: CSRF_HEADER_VALUE } }));
};
