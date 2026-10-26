import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService, LOGIN_PATH, SETUP_PATH } from './auth.service';

/**
 * Lets signed-in admins pass and sends everyone else to the login page (`/login?next=…`), or to the first-run setup
 * while no account exists yet. When the server cannot be reached the guard lets the operator through: the page then
 * shows its offline state and any 401 from the API or the hub still leads to the login page.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const status = await auth.ensureSession();
  if (status !== 'anonymous') {
    return true;
  }
  if ((await auth.fetchSetupRequired()) === true) {
    return router.createUrlTree([SETUP_PATH]);
  }
  return router.createUrlTree([LOGIN_PATH], {
    queryParams: state.url && state.url !== '/' ? { next: state.url } : {},
  });
};

/** The login page exists only once an account exists: while the first-run setup is open it leads to the setup page. */
export const loginGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return (await auth.fetchSetupRequired()) === true ? router.createUrlTree([SETUP_PATH]) : true;
};

/** The first-run setup page exists only until the account is created: afterwards it leads to the login page. */
export const setupGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return (await auth.fetchSetupRequired()) === false ? router.createUrlTree([LOGIN_PATH]) : true;
};
