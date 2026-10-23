import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';

/** Base document title of the Regie. */
export const APP_TITLE = 'StudioFlow Regie';

/**
 * Document titles: «StudioFlow Regie» for the Regie, «Anmelden · StudioFlow Regie» etc. for routes with a `title`.
 */
@Injectable({ providedIn: 'root' })
export class StudioTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const route = this.buildTitle(snapshot);
    this.title.setTitle(route ? `${route} · ${APP_TITLE}` : APP_TITLE);
  }
}
