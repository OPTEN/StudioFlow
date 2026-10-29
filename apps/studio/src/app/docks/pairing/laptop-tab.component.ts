import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { IconComponent } from '../../core/ui/icon.component';
import { PublicUrlService, displayUrl } from './public-url.service';

/**
 * "Laptop" tab of the pairing dock (prototype `renderPair` laptop): three numbered steps around the short address
 * "‹host›/join", shown large in mono with "Copy". The second step names the audio station, which pairs the same way,
 * so the sound of the mixing desk has an obvious way in. The requests themselves appear in the side column with their
 * check codes.
 */
@Component({
  selector: 'sf-laptop-tab',
  imports: [IconComponent],
  template: `
    <h3 class="c-pair__title">{{ t('regie.pairing.laptop.title') }}</h3>
    <ol class="c-pair__steps">
      <li>
        {{ t('regie.pairing.laptop.step1') }}
        <span class="c-pair__big-url">
          <span class="c-pair__url" #url>{{ shownUrl() }}</span>
          <button class="c-btn c-btn--sm" type="button" (click)="copy()">
            <svg sfIcon="copy" [size]="14"></svg>{{ t('common.copy') }}
          </button>
        </span>
      </li>
      <li>{{ t('regie.pairing.laptop.step2') }}</li>
      <li>{{ t('regie.pairing.laptop.step3') }}</li>
    </ol>
  `,
  styleUrl: './pairing-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaptopTabComponent {
  protected readonly t = t;
  private readonly urls = inject(PublicUrlService);
  private readonly clipboard = inject(ClipboardService);
  private readonly urlElement = viewChild.required<ElementRef<HTMLElement>>('url');

  protected readonly shownUrl = computed(() => displayUrl(this.urls.joinUrl()));

  constructor() {
    this.urls.ensureLoaded();
  }

  protected copy(): void {
    void this.clipboard.copy(this.urls.joinUrl(), {
      label: this.shownUrl(),
      selectElement: this.urlElement().nativeElement,
    });
  }
}
