import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService, LOGIN_PATH } from './auth.service';

/**
 * Lets signed-in admins pass and sends everyone else to the login page (`/login?next=…`). When the server cannot be
 * reached the guard lets the operator through: the page then shows its offline state and any 401 from the API or the
 * hub still leads to the login page.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const status = await auth.ensureSession();
  if (status !== 'anonymous') {
    return true;
  }
  return router.createUrlTree([LOGIN_PATH], {
    queryParams: state.url && state.url !== '/' ? { next: state.url } : {},
  });
};
