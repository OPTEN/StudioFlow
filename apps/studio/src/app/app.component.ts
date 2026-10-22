import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastHostComponent } from './shell/toast-host.component';

/** Root component: the routed page and the toast live region (available on every page, also on the login). */
@Component({
  selector: 'fs-root',
  imports: [RouterOutlet, ToastHostComponent],
  template: `
    <router-outlet />
    <fs-toast-host />
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}
