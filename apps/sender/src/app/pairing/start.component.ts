import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { t } from '@studioflow/i18n';
import { LIMITS, type DeviceKind } from '@studioflow/scene-model';
import {
  DEVICE_ENVIRONMENT,
  defaultDeviceName,
  detectDeviceKind,
} from '../core/device-environment';
import { NoticeService } from '../core/notice.service';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { IconComponent } from '../shared/icon.component';
import { LanguageSelectComponent } from '../shared/language-select.component';
import { KnockService } from './knock.service';

/**
 * `/join/`: the pairing form (spec 4.6, way 2). Name (1–60 characters, prefilled from the platform) and kind
 * (detected, switchable); “Continue” knocks and opens the waiting screen with the check code. Paired browsers and tabs
 * with a pending knock never get here (see `startGuard`).
 */
@Component({
  selector: 'sf-start',
  imports: [ReactiveFormsModule, BrandMarkComponent, IconComponent, LanguageSelectComponent],
  templateUrl: './start.component.html',
  styleUrl: './start.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartComponent {
  private readonly router = inject(Router);
  private readonly knock = inject(KnockService);
  private readonly environment = inject(DEVICE_ENVIRONMENT);

  protected readonly t = t;
  protected readonly nameMax = LIMITS.deviceNameLength;
  protected readonly canShareScreen = this.environment.canShareScreen();
  protected readonly notice = signal(inject(NoticeService).takePairingNotice());
  protected readonly submitted = signal(false);
  protected readonly busy = computed(() => this.knock.phase() === 'requesting');
  protected readonly error = computed(() => this.knock.error()?.userMessage ?? null);

  private readonly platform = this.environment.platform();
  private readonly previous = this.knock.lastRequest();
  private readonly initialKind: DeviceKind =
    this.previous?.kind ?? detectDeviceKind(this.environment);

  protected readonly form = new FormGroup({
    name: new FormControl(
      this.previous?.name ?? defaultDeviceName(this.initialKind, this.platform),
      {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(LIMITS.deviceNameLength)],
      },
    ),
    kind: new FormControl<DeviceKind>(this.initialKind, { nonNullable: true }),
  });

  protected readonly kind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.initialKind,
  });
  private readonly nameValue = toSignal(this.form.controls.name.valueChanges, {
    initialValue: this.form.controls.name.value,
  });

  /** Validation message of the name, shown after a submit attempt. */
  protected readonly nameError = computed(() => {
    if (!this.submitted()) {
      return null;
    }
    const name = this.nameValue().trim();
    if (name === '') {
      return t('sender.pairing.start.nameRequired');
    }
    return name.length > LIMITS.deviceNameLength
      ? t('sender.pairing.start.nameTooLong', { max: LIMITS.deviceNameLength })
      : null;
  });

  constructor() {
    this.form.controls.kind.valueChanges.pipe(takeUntilDestroyed()).subscribe((kind) => {
      // A suggested name follows the kind until the user typed their own.
      if (!this.form.controls.name.dirty) {
        this.form.controls.name.setValue(defaultDeviceName(kind, this.platform));
      }
    });
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    const name = this.form.controls.name.value.trim();
    if (name === '' || name.length > LIMITS.deviceNameLength || this.busy()) {
      return;
    }
    const accepted = await this.knock.request(name, this.form.controls.kind.value, this.platform);
    if (accepted) {
      await this.router.navigate(['/warten']);
    }
  }
}
