import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { IconComponent } from '../core/ui/icon.component';
import { LanguageSelectComponent } from '../core/ui/language-select.component';
import { SetupStepsComponent } from '../setup/setup-steps.component';
import { AddressSectionComponent } from './address-section.component';
import { EmbeddingSectionComponent } from './embedding-section.component';
import { MediaSectionComponent } from './media-section.component';

/** The steps after the account (the account is the first step, on the setup page). */
export type WizardStep = 'media' | 'address' | 'embedding' | 'done';

/** The title and the sentence below it, per step. */
const STEP_TEXT: Readonly<Record<WizardStep, { title: PlainMessageKey; lead: PlainMessageKey }>> = {
  media: { title: 'regie.server.wizard.mediaTitle', lead: 'regie.server.wizard.mediaLead' },
  address: { title: 'regie.server.wizard.addressTitle', lead: 'regie.server.wizard.addressLead' },
  embedding: {
    title: 'regie.server.wizard.embeddingTitle',
    lead: 'regie.server.wizard.embeddingLead',
  },
  done: { title: 'regie.server.wizard.doneTitle', lead: 'regie.server.wizard.doneText' },
};

/**
 * The first-run wizard after the account (`/setup/server`, issue #27), in the setup-assistant card of the login page with
 * the step indicator of the whole first run: the media server with a connection test, the address and certificate, and
 * the embedding. Each step is saved on its own; the media address makes the installation "configured" (the pages of
 * the Regie open from then on), so the later steps offer "Keep the defaults" (with what that keeps, in plain words)
 * and Back. The focus moves to the title of each new step.
 */
@Component({
  selector: 'sf-server-wizard',
  imports: [
    AddressSectionComponent,
    EmbeddingSectionComponent,
    IconComponent,
    LanguageSelectComponent,
    MediaSectionComponent,
    SetupStepsComponent,
  ],
  templateUrl: './server-wizard.component.html',
  styleUrls: ['../login/login-page.component.scss', './server-wizard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerWizardComponent {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');
  protected readonly settings = inject(ServerSettingsService);

  protected readonly t = t;
  protected readonly step = signal<WizardStep>('media');
  protected readonly loadFailed = signal(false);
  protected readonly text = computed(() => STEP_TEXT[this.step()]);
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
    this.go('address');
  }

  protected addressSaved(baseUrl: string): void {
    this.rememberAddress(baseUrl);
    this.go('embedding');
  }

  protected embeddingSaved(): void {
    this.go('done');
  }

  /** "Keep the defaults": the step stays as it is on the server. */
  protected skip(): void {
    this.go(this.step() === 'address' ? 'embedding' : 'done');
  }

  /** One step back; the step shows what is saved on the server. */
  protected back(): void {
    this.go(this.step() === 'embedding' ? 'address' : 'media');
  }

  protected async open(): Promise<void> {
    await this.router.navigateByUrl('/');
  }

  private go(step: WizardStep): void {
    this.step.set(step);
    afterNextRender(() => this.title()?.nativeElement.focus(), { injector: this.injector });
  }

  private rememberAddress(baseUrl: string): void {
    this.newAddress.set(new URL(baseUrl).origin === this.document.location.origin ? null : baseUrl);
  }
}
