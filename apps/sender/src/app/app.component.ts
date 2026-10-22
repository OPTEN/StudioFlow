import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppUpdateService } from './core/app-update.service';
import { RouteFocusService } from './core/route-focus.service';

/** Root component: hosts the screens; starts the focus handling and the service worker update logic. */
@Component({
  selector: 'fs-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  constructor() {
    inject(RouteFocusService).start();
    inject(AppUpdateService);
  }
}
