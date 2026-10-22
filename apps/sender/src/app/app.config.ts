import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import localeDeCh from '@angular/common/locales/de-CH';
import localeDeChExtra from '@angular/common/locales/extra/de-CH';
import {
  LOCALE_ID,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { deviceAuthInterceptor } from './core/device-auth.interceptor';

registerLocaleData(localeDeCh, 'de-CH', localeDeChExtra);

/** Providers of the sender PWA. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([deviceAuthInterceptor])),
    { provide: LOCALE_ID, useValue: 'de-CH' },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
