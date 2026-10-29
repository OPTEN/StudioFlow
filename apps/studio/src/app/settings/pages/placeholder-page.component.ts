import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import type { Observable } from 'rxjs';
import { SettingsPageHeadComponent, type SettingsScope } from './settings-page-head.component';

/** Route data of a settings page that is still being moved into the settings window. */
interface PlaceholderData {
  readonly navKey?: PlainMessageKey;
  readonly scope?: SettingsScope;
}

/** A settings page that only shows its title and scope (scaffolding while a page moves into the settings window). */
@Component({
  selector: 'sf-placeholder-page',
  imports: [SettingsPageHeadComponent],
  template: `
    <div class="c-page">
      <sf-settings-page-head [title]="title()" [scope]="data()?.scope ?? 'none'" />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderPageComponent {
  protected readonly data = toSignal(inject(ActivatedRoute).data as Observable<PlaceholderData>);
  protected readonly title = computed(() => {
    const key = this.data()?.navKey;
    return key ? t(key) : '';
  });
}
