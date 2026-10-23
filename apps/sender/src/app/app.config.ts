import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  isDevMode,
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideI18n } from '@studioflow/i18n/angular';
import { routes } from './app.routes';
import { deviceAuthInterceptor } from './core/device-auth.interceptor';

/** Providers of the sender PWA. The language comes from `provideI18n`. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideI18n(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([deviceAuthInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
