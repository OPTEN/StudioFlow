import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { ServerSettingsService } from './server-settings.service';

/** Path of the first-run wizard after the account (media address, address and certificate, embedding). */
export const SERVER_SETUP_PATH = '/setup/server';

/**
 * Keeps the Regie closed until the installation is configured (the media address was saved in the first-run wizard):
 * a signed-in admin who has not finished the wizard continues there. When the server cannot be reached the guard lets
 * the operator through, like the auth guard.
 */
export const configuredGuard: CanActivateFn = async () => {
  const settings = inject(ServerSettingsService);
  const router = inject(Router);
  return (await settings.ensureConfigured()) === false
    ? router.createUrlTree([SERVER_SETUP_PATH])
    : true;
};

/** The wizard exists only until the installation is configured: afterwards its address leads to the Regie. */
export const wizardGuard: CanActivateFn = async () => {
  const settings = inject(ServerSettingsService);
  const router = inject(Router);
  return (await settings.ensureConfigured()) === true ? router.createUrlTree(['/']) : true;
};
