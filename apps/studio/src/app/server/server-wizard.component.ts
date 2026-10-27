import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { t } from '@studioflow/i18n';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { IconComponent } from '../core/ui/icon.component';
import { LanguageSelectComponent } from '../core/ui/language-select.component';
import { AddressSectionComponent } from './address-section.component';
import { EmbeddingSectionComponent } from './embedding-section.component';
import { MediaSectionComponent } from './media-section.component';

/** The steps after the account; the account is step 1 of {@link WIZARD_STEPS_TOTAL}. */
export type WizardStep = 'media' | 'address' | 'embedding' | 'done';

/** Account, media address, address and certificate, embedding. */
export const WIZARD_STEPS_TOTAL = 4;

const STEP_NUMBER: Readonly<Record<WizardStep, number>> = {
  media: 2,
  address: 3,
  embedding: 4,
  done: 4,
};

/**
 * The first-run wizard after the account (`/setup/server`, issue #27): the media address with a connection test, the
 * address and certificate, and the embedding. The account was step 1 on the setup page. Each step is saved on its own;
 * the media address makes the installation "configured" (the pages of the Regie open from then on), so the address and
 * the embedding can also be set later under "Server settings", and "Keep the defaults" goes on without changing them.
 * The page shares the look of the login page.
 */
@Component({
  selector: 'sf-server-wizard',
  imports: [
    AddressSectionComponent,
    EmbeddingSectionComponent,
    IconComponent,
    LanguageSelectComponent,
    MediaSectionComponent,
  ],
  templateUrl: './server-wizard.component.html',
  styleUrls: ['../login/login-page.component.scss', './server-wizard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerWizardComponent {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  protected readonly settings = inject(ServerSettingsService);

  protected readonly t = t;
  protected readonly step = signal<WizardStep>('media');
  protected readonly loadFailed = signal(false);
  protected readonly stepNumber = computed(() => STEP_NUMBER[this.step()]);
  protected readonly total = WIZARD_STEPS_TOTAL;
  protected readonly stepLabel = computed(() => {
    switch (this.step()) {
      case 'media':
        return t('regie.server.wizard.stepsMedia');
      case 'address':
        return t('regie.server.wizard.stepsAddress');
      default:
        return t('regie.server.wizard.stepsEmbedding');
    }
  });
  /** The segments of the progress bar: done, current or still to do. */
  protected readonly segments = computed(() =>
    Array.from({ length: WIZARD_STEPS_TOTAL }, (_, index) => {
      const number = index + 1;
      if (this.step() === 'done' || number < this.stepNumber()) {
        return 'done';
      }
      return number === this.stepNumber() ? 'current' : 'todo';
    }),
  );
  /** The address devices open from now on, when it is not the one this page was opened at. */
  protected readonly newAddress = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      await this.settings.load();
    } catch {
      this.loadFailed.set(true);
    }
  }

  protected mediaSaved(): void {
    this.step.set('address');
  }

  protected addressSaved(baseUrl: string): void {
    this.rememberAddress(baseUrl);
    this.step.set('embedding');
  }

  protected embeddingSaved(): void {
    this.step.set('done');
  }

  /** "Keep the defaults": the step stays as it is on the server. */
  protected skip(): void {
    this.step.set(this.step() === 'address' ? 'embedding' : 'done');
  }

  protected async open(): Promise<void> {
    await this.router.navigateByUrl('/');
  }

  private rememberAddress(baseUrl: string): void {
    this.newAddress.set(new URL(baseUrl).origin === this.document.location.origin ? null : baseUrl);
  }
}
