import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/** Requests whose 401 is an expected answer and handled by the caller (login form, session check, logout). */
const OWN_401_URLS = ['/api/auth/login', '/api/auth/me', '/api/auth/logout'];

/**
 * Sends the operator to the login page when the session expired: any 401 from the API (except the login and session
 * check calls themselves) calls `AuthService.handleUnauthorized()`. The error still reaches the caller.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !OWN_401_URLS.some((url) => request.url.startsWith(url))
      ) {
        auth.handleUnauthorized();
      }
      return throwError(() => error);
    }),
  );
};
