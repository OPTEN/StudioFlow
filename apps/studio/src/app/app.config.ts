import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
} from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './core/api/auth.interceptor';
import { csrfInterceptor } from './core/api/csrf.interceptor';
import { StudioTitleStrategy } from './core/ui/studio-title.strategy';

/** Application providers of the Regie (zoneless by default in Angular 22; locale data registered in main.ts). */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([csrfInterceptor, authInterceptor])),
    { provide: LOCALE_ID, useValue: 'de-CH' },
    { provide: TitleStrategy, useClass: StudioTitleStrategy },
  ],
};
