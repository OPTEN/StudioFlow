import type { Routes } from '@angular/router';
import type { PlainMessageKey } from '@studioflow/i18n';
import { authGuard, loginGuard, setupGuard } from './core/auth/auth.guard';
import { configuredGuard, wizardGuard } from './core/state/server-settings.guard';
import { LoginPageComponent } from './login/login-page.component';
import { SetupPageComponent } from './setup/setup-page.component';

/**
 * Routes of the Regie (spec 9.1). The Regie, the monitoring page, the audit log and the server settings are lazy chunks, so
 * the login page stays small; livekit-client is loaded even later, by `StudioMediaService`. While no account exists the
 * login leads to the first-run setup, and once the account exists the setup leads to the login. After the account the
 * wizard (`/setup/server`) sets the media address, the address and certificate and the embedding; until the media
 * address is saved the pages of the Regie lead to the wizard (`configuredGuard`).
 */
export const routes: Routes = [
  {
    path: 'login',
    component: LoginPageComponent,
    canActivate: [loginGuard],
    data: { titleKey: 'regie.login.title' satisfies PlainMessageKey },
  },
  {
    path: 'setup',
    component: SetupPageComponent,
    canActivate: [setupGuard],
    data: { titleKey: 'regie.setup.title' satisfies PlainMessageKey },
  },
  {
    path: 'setup/server',
    canActivate: [authGuard, wizardGuard],
    data: { titleKey: 'regie.server.wizard.title' satisfies PlainMessageKey },
    loadComponent: () =>
      import('./server/server-wizard.component').then((m) => m.ServerWizardComponent),
  },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard, configuredGuard],
    loadComponent: () => import('./shell/studio-page.component').then((m) => m.StudioPageComponent),
  },
  {
    path: 'monitoring',
    canActivate: [authGuard, configuredGuard],
    data: { titleKey: 'regie.monitoring.title' satisfies PlainMessageKey },
    loadComponent: () =>
      import('./monitoring/monitoring-page.component').then((m) => m.MonitoringPageComponent),
  },
  {
    path: 'audit',
    canActivate: [authGuard, configuredGuard],
    data: { titleKey: 'regie.audit.title' satisfies PlainMessageKey },
    loadComponent: () => import('./audit/audit-page.component').then((m) => m.AuditPageComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard, configuredGuard],
    data: { titleKey: 'regie.server.title' satisfies PlainMessageKey },
    loadComponent: () =>
      import('./server/server-settings-page.component').then((m) => m.ServerSettingsPageComponent),
  },
  { path: '**', redirectTo: '' },
];
