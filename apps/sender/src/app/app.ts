import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HUB } from '@flowstudio/scene-model';

/** Root component: hosts the router outlet. */
@Component({
  selector: 'fs-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly hubPath = HUB.studioPath;
}
