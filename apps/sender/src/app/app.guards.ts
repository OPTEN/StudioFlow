import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { CredentialsService } from './core/credentials.service';
import { KnockService } from './pairing/knock.service';

/** `/join/`: a paired browser goes straight to its station, a tab with a pending knock back to the code. */
export const startGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (inject(CredentialsService).paired()) {
    return router.createUrlTree(['/station']);
  }
  if (inject(KnockService).hasPending()) {
    return router.createUrlTree(['/warten']);
  }
  return true;
};

/** `/join/station` needs credentials. */
export const stationGuard: CanActivateFn = () =>
  inject(CredentialsService).paired() ? true : inject(Router).createUrlTree(['/']);

/** `/join/warten` needs a knock of this tab (pending, or just answered so the result can be shown). */
export const waitingGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (inject(CredentialsService).paired()) {
    return router.createUrlTree(['/station']);
  }
  const knock = inject(KnockService);
  const phase = knock.phase();
  return knock.hasPending() || phase === 'denied' || phase === 'expired'
    ? true
    : router.createUrlTree(['/']);
};
