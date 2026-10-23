import { registerLocaleData } from '@angular/common';
import localeDeCh from '@angular/common/locales/de-CH';
import localeDeChExtra from '@angular/common/locales/extra/de-CH';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// German (Switzerland) formats for Angular pipes; StudioFlow's own formatting lives in @studioflow/scene-model.
registerLocaleData(localeDeCh, 'de-CH', localeDeChExtra);

bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => console.error(error));
