import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { formatCheckCode, type PairingRequestDto } from '@studioflow/scene-model';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { IconComponent } from '../../core/ui/icon.component';
import { PairingRequestsService } from './pairing-requests.service';
import { PublicUrlService, displayUrl } from './public-url.service';

/** Example check code of the mini preview while nobody knocks (prototype). */
const EXAMPLE_CODE = '47 12';

/**
 * "Laptop" tab of the pairing dock (prototype `renderPair` laptop): the short address "‹host›/join" in large mono
 * with "Copy", the explanation and a mini preview of what the laptop shows (the name and check code of the first
 * waiting request, or an example). The requests themselves appear in the side column.
 */
@Component({
  selector: 'sf-laptop-tab',
  imports: [IconComponent],
  template: `
    <h3 class="c-pair__title">{{ t('regie.pairing.laptop.title') }}</h3>
    <p class="c-pair__text">{{ t('regie.pairing.laptop.open') }}</p>
    <div class="c-pair__big-url">
      <span class="c-pair__url" #url>{{ shownUrl() }}</span>
      <button class="c-btn c-btn--sm" type="button" (click)="copy()">
        <svg sfIcon="copy" [size]="14"></svg>{{ t('common.copy') }}
      </button>
    </div>
    <p class="c-pair__text">{{ t('regie.pairing.laptop.enterName') }}</p>
    <div class="c-pair__mini" aria-hidden="true">
      <div class="c-pair__mini-bar">{{ t('regie.pairing.laptop.miniBar') }}</div>
      <div class="c-pair__mini-body">
        <span class="c-pair__mini-field" [class.is-example]="!firstRequest()">{{
          firstRequest()?.name ?? t('regie.pairing.laptop.miniName')
        }}</span>
        <span class="c-pair__mini-cap">{{ t('regie.pairing.laptop.miniCode') }}</span>
        <span class="c-pair__mini-code">{{ code() }}</span>
      </div>
    </div>
  `,
  styleUrl: './pairing-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaptopTabComponent {
  protected readonly t = t;
  private readonly urls = inject(PublicUrlService);
  private readonly clipboard = inject(ClipboardService);
  private readonly requests = inject(PairingRequestsService);
  private readonly urlElement = viewChild.required<ElementRef<HTMLElement>>('url');

  protected readonly shownUrl = computed(() => displayUrl(this.urls.joinUrl()));
  protected readonly firstRequest = computed<PairingRequestDto | null>(
    () => this.requests.pending()[0] ?? null,
  );
  protected readonly code = computed(() => {
    const request = this.firstRequest();
    return request ? formatCheckCode(request.checkCode) : EXAMPLE_CODE;
  });

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
