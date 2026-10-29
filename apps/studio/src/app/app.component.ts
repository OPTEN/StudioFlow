import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ContextMenuHostComponent } from './core/ui/context-menu';
import { ToastHostComponent } from './shell/toast-host.component';

/** Root component: the routed page, the right-click menu and the toast live region (available on every page, also on the login). */
@Component({
  selector: 'sf-root',
  imports: [ContextMenuHostComponent, RouterOutlet, ToastHostComponent],
  template: `
    <router-outlet />
    <sf-toast-host />
    <sf-context-menu-host />
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
