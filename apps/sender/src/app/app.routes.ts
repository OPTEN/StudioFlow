import type { Routes } from '@angular/router';
import { startGuard, stationGuard, waitingGuard } from './app.guards';

/** Document title of every screen. */
const TITLE = 'FlowStudio Sender';

/**
 * Routes under the base `/join/` (spec 9.2). Screens are lazy so the app shell stays small; the service worker
 * prefetches every chunk, so the station also starts offline.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: TITLE,
    canActivate: [startGuard],
    loadComponent: () => import('./pairing/start.component').then((m) => m.StartComponent),
  },
  {
    path: 'i/:token',
    title: TITLE,
    loadComponent: () => import('./pairing/redeem.component').then((m) => m.RedeemComponent),
  },
  {
    path: 'warten',
    title: TITLE,
    canActivate: [waitingGuard],
    loadComponent: () => import('./pairing/waiting.component').then((m) => m.WaitingComponent),
  },
  {
    path: 'station',
    title: TITLE,
    canActivate: [stationGuard],
    loadComponent: () => import('./station/station.component').then((m) => m.StationComponent),
  },
  { path: '**', redirectTo: '' },
];
