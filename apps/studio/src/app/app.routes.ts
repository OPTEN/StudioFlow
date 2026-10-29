import type { Route, Routes } from '@angular/router';
import type { PlainMessageKey } from '@studioflow/i18n';
import { authGuard, loginGuard, setupGuard } from './core/auth/auth.guard';
import { configuredGuard, wizardGuard } from './core/state/server-settings.guard';
import { LoginPageComponent } from './login/login-page.component';
import { SetupPageComponent } from './setup/setup-page.component';

/** A server page of the settings window (one section of the server settings). */
function serverPage(
  section: 'media' | 'network' | 'embedding' | 'backups',
  titleKey: PlainMessageKey,
): Route {
  return {
    path: `settings/${section}`,
    data: { titleKey, section },
    loadComponent: () =>
      import('./settings/pages/server-page.component').then((m) => m.ServerPageComponent),
  };
}

/** A production page of the settings window. */
function productionPage(path: string, titleKey: PlainMessageKey): Route {
  return {
    path: `settings/${path}`,
    data: { titleKey, navKey: titleKey, scope: 'production' },
    loadComponent: () =>
      import('./settings/pages/placeholder-page.component').then((m) => m.PlaceholderPageComponent),
  };
}

/**
 * Routes of the Regie (spec 9.1). The Regie and the settings window (with monitoring and the audit log) are lazy chunks, so
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
    // The settings window: a sidebar grouped by scope next to the page (settings/settings-nav.ts). Monitoring and the
    // audit log live in it as diagnostics, so every page around the control room shares one navigation.
    path: '',
    canActivate: [authGuard, configuredGuard],
    loadComponent: () =>
      import('./settings/settings-shell.component').then((m) => m.SettingsShellComponent),
    children: [
      {
        path: 'monitoring',
        data: { titleKey: 'regie.monitoring.title' satisfies PlainMessageKey },
        loadComponent: () =>
          import('./monitoring/monitoring-page.component').then((m) => m.MonitoringPageComponent),
      },
      {
        path: 'audit',
        data: { titleKey: 'regie.audit.title' satisfies PlainMessageKey },
        loadComponent: () =>
          import('./audit/audit-page.component').then((m) => m.AuditPageComponent),
      },
      { path: 'settings', pathMatch: 'full', redirectTo: 'settings/production' },
      productionPage('production', 'regie.settings.nav.general'),
      productionPage('slates', 'regie.settings.nav.slates'),
      productionPage('text-style', 'regie.settings.nav.textStyle'),
      productionPage('output', 'regie.settings.nav.output'),
      productionPage('productions', 'regie.settings.nav.productions'),
      {
        path: 'settings/appearance',
        data: { titleKey: 'regie.settings.nav.appearance' satisfies PlainMessageKey },
        loadComponent: () =>
          import('./settings/pages/appearance-page.component').then(
            (m) => m.AppearancePageComponent,
          ),
      },
      serverPage('media', 'regie.settings.nav.media'),
      serverPage('network', 'regie.settings.nav.network'),
      serverPage('embedding', 'regie.settings.nav.embedding'),
      serverPage('backups', 'regie.settings.nav.backups'),
      {
        path: 'settings/account',
        data: { titleKey: 'regie.settings.nav.account' satisfies PlainMessageKey },
        loadComponent: () =>
          import('./settings/pages/account-page.component').then((m) => m.AccountPageComponent),
      },
      {
        path: 'settings/about',
        data: { titleKey: 'regie.settings.nav.about' satisfies PlainMessageKey },
        loadComponent: () =>
          import('./settings/pages/about-page.component').then((m) => m.AboutPageComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
