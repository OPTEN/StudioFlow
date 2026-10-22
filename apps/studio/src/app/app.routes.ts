import type { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { LoginPageComponent } from './login/login-page.component';

/**
 * Routes of the Regie (spec 9.1). The Regie and the monitoring page are lazy chunks, so the login page stays small;
 * livekit-client is loaded even later, by `StudioMediaService`.
 */
export const routes: Routes = [
  { path: 'login', component: LoginPageComponent, title: 'Anmelden' },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/studio-page.component').then((m) => m.StudioPageComponent),
  },
  {
    path: 'monitoring',
    canActivate: [authGuard],
    title: 'Monitoring',
    loadComponent: () =>
      import('./monitoring/monitoring-page.component').then((m) => m.MonitoringPageComponent),
  },
  { path: '**', redirectTo: '' },
];
