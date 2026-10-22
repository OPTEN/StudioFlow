import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CredentialsService } from './credentials.service';

/** REST routes of the sender that need the device credential (spec 4.6). */
const DEVICE_ROUTE = /^\/api\/device(\/|$)/;

/** Adds `Authorization: Bearer {deviceId}.{secret}` to the device routes (never to pairing or other routes). */
export const deviceAuthInterceptor: HttpInterceptorFn = (request, next) => {
  if (!DEVICE_ROUTE.test(request.url) || request.headers.has('Authorization')) {
    return next(request);
  }
  const bearer = inject(CredentialsService).bearer();
  return next(
    bearer === null
      ? request
      : request.clone({ setHeaders: { Authorization: `Bearer ${bearer}` } }),
  );
};
