import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { provideI18n } from '@studioflow/i18n/angular';
import { routes } from './app.routes';
import { authInterceptor } from './core/api/auth.interceptor';
import { csrfInterceptor } from './core/api/csrf.interceptor';
import { StudioTitleStrategy } from './core/ui/studio-title.strategy';

/** Application providers of the Regie (zoneless by default in Angular 22; the language comes from provideI18n). */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideI18n(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([csrfInterceptor, authInterceptor])),
    { provide: TitleStrategy, useClass: StudioTitleStrategy },
  ],
};
