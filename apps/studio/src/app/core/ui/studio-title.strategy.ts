import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';
import { t, type PlainMessageKey } from '@studioflow/i18n';

/** Name of the route `data` entry that holds the message key of the page title. */
export const TITLE_KEY = 'titleKey';

/**
 * Document title: the app title alone, "<page> · <app title>" for a page with a title key, or "<status> · <app title>"
 * for the control room while it reports a status ("● On air · Webinar", "2 issues · Webinar").
 */
export function documentTitle(
  titleKey: PlainMessageKey | null,
  status: string | null = null,
): string {
  const app = t('regie.core.appTitle');
  if (titleKey) {
    return `${t(titleKey)} · ${app}`;
  }
  return status ? `${status} · ${app}` : app;
}

function titleKeyOf(snapshot: RouterStateSnapshot): PlainMessageKey | null {
  let route = snapshot.root;
  let titleKey: PlainMessageKey | null = null;
  for (;;) {
    const candidate: unknown = route.data[TITLE_KEY];
    if (typeof candidate === 'string') {
      titleKey = candidate as PlainMessageKey;
    }
    const child = route.firstChild;
    if (!child) {
      return titleKey;
    }
    route = child;
  }
}

/**
 * Document titles: "StudioFlow Control room" for the Regie, "Sign in · StudioFlow Control room" etc. for routes with
 * `data: { titleKey }`. The router resolves `Routes[].title` only once, so the title is rebuilt from the key whenever
 * the language changes. The control room adds its state with {@link setStatus}, so an operator with the output in
 * another tab still sees in the tab strip that the broadcast is on air or that a device has a problem.
 */
@Injectable({ providedIn: 'root' })
export class StudioTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly titleKey = signal<PlainMessageKey | null>(null);
  private readonly status = signal<string | null>(null);

  constructor() {
    super();
    effect(() => this.title.setTitle(documentTitle(this.titleKey(), this.status())));
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.titleKey.set(titleKeyOf(snapshot));
  }

  /** The state of the control room in front of the app title, or null to show the plain title. */
  setStatus(status: string | null): void {
    this.status.set(status);
  }
}
