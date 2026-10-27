import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { msg, t, tm, type Msg } from '@studioflow/i18n';
import { SETTINGS_FIELD_ERROR_CODES as CODES } from '@studioflow/scene-model';
import { ApiError, toUserMsg } from '../core/api/api-error';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { RefusedFields, focusFirstInvalid } from '../core/ui/form-feedback';
import {
  MAX_AGE_KEYS,
  MAX_KEEP_DAILY,
  MAX_KEEP_WEEKLY,
  fieldIndex,
  firstInvalidLine,
  isAgeKey,
  textLines,
} from './server-rules';

type Field = 'schedule' | 'timezone' | 'keepDaily' | 'keepWeekly' | 'remote' | 'config' | 'age';

/** How long the form waits for the backup service to read the new settings (it checks every few seconds). */
const BACKUP_APPLY_MS = 15_000;

function wholeNumberIn(value: number | null, max: number): boolean {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= max;
}

/**
 * The backup schedule and the off-site target (issue #27), only on the "Server settings" page: when automatic backups run
 * (a cron expression and its time zone), how many daily and weekly backups are kept, and where an encrypted copy goes
 * (an rclone remote with its configuration, and the public age keys that encrypt it). The configuration is stored
 * encrypted and never shown again. The backup service reads the settings from a shared volume within seconds.
 */
@Component({
  selector: 'sf-backup-section',
  imports: [ReactiveFormsModule],
  templateUrl: './backup-section.component.html',
  styleUrl: './server-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupSectionComponent {
  private readonly settings = inject(ServerSettingsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly refused = new RefusedFields<Field>();
  private readonly current = this.settings.settings()?.backup;

  /** Emitted after the settings are saved. */
  readonly saved = output<void>();

  protected readonly t = t;
  protected readonly limits = { daily: MAX_KEEP_DAILY, weekly: MAX_KEEP_WEEKLY };
  protected readonly schedule = new FormControl(this.current?.schedule ?? '', {
    nonNullable: true,
  });
  protected readonly timezone = new FormControl(this.current?.timezone ?? '', {
    nonNullable: true,
  });
  protected readonly keepDaily = new FormControl<number | null>(this.current?.keepDaily ?? 7);
  protected readonly keepWeekly = new FormControl<number | null>(this.current?.keepWeekly ?? 4);
  protected readonly remote = new FormControl(this.current?.rcloneRemote ?? '', {
    nonNullable: true,
  });
  protected readonly config = new FormControl('', { nonNullable: true });
  protected readonly age = new FormControl((this.current?.ageRecipients ?? []).join('\n'), {
    nonNullable: true,
  });
  protected readonly unencrypted = new FormControl(this.current?.offsiteUnencrypted ?? false, {
    nonNullable: true,
  });
  protected readonly configStored = computed(
    () => this.settings.settings()?.backup.rcloneConfigured ?? false,
  );
  protected readonly saving = signal(false);
  protected readonly error = signal<Msg | null>(null);
  protected readonly errorText = computed(() => tm(this.error()) || null);
  protected readonly notice = signal<Msg | null>(null);
  protected readonly noticeText = computed(() => tm(this.notice()) || null);

  constructor() {
    const watched: [Field, FormControl][] = [
      ['schedule', this.schedule],
      ['timezone', this.timezone],
      ['keepDaily', this.keepDaily],
      ['keepWeekly', this.keepWeekly],
      ['remote', this.remote],
      ['config', this.config],
      ['age', this.age],
    ];
    for (const [field, control] of watched) {
      control.valueChanges.subscribe(() => this.refused.clear(field));
    }
    this.unencrypted.valueChanges.subscribe(() => this.refused.clear('age'));
  }

  protected fieldError(field: Field): string | null {
    const message = this.refused.get(field);
    return message ? tm(message) : null;
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) {
      return;
    }
    const problems = this.check();
    this.refused.set(problems);
    if (Object.keys(problems).length > 0) {
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    this.error.set(null);
    this.notice.set(null);
    this.saving.set(true);
    try {
      await this.settings.saveBackup({
        schedule: this.schedule.value.trim() || null,
        timezone: this.timezone.value.trim() || null,
        keepDaily: this.keepDaily.value ?? 0,
        keepWeekly: this.keepWeekly.value ?? 0,
        rcloneRemote: this.remote.value.trim() || null,
        rcloneConfig: this.config.value.trim() ? this.config.value : null,
        ageRecipients: textLines(this.age.value),
        offsiteUnencrypted: this.unencrypted.value,
      });
      this.config.reset('', { emitEvent: false });
      const outcome = await this.settings.waitUntilApplied(['backup'], BACKUP_APPLY_MS);
      if (!outcome.applied) {
        // The settings are saved; the service picks them up when it runs. No reason to fail the form.
        this.notice.set(msg('regie.server.apply.backup'));
      }
      this.saved.emit();
    } catch (error) {
      this.showFailure(ApiError.from(error));
    } finally {
      this.saving.set(false);
    }
  }

  private ageKeys(): string[] {
    return textLines(this.age.value)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private check(): Partial<Record<Field, Msg>> {
    const problems: Partial<Record<Field, Msg>> = {};
    if (!wholeNumberIn(this.keepDaily.value, MAX_KEEP_DAILY)) {
      problems['keepDaily'] = msg('regie.server.backup.keepInvalid', {
        min: 1,
        max: MAX_KEEP_DAILY,
      });
    }
    if (!wholeNumberIn(this.keepWeekly.value, MAX_KEEP_WEEKLY)) {
      problems['keepWeekly'] = msg('regie.server.backup.keepInvalid', {
        min: 1,
        max: MAX_KEEP_WEEKLY,
      });
    }
    const badKey = firstInvalidLine(textLines(this.age.value), isAgeKey);
    if (badKey !== null) {
      problems['age'] = msg('regie.server.backup.offsiteAgeInvalid', { line: badKey });
    } else if (this.ageKeys().length > MAX_AGE_KEYS) {
      problems['age'] = msg('regie.server.backup.offsiteAgeInvalid', { line: MAX_AGE_KEYS + 1 });
    } else if (this.remote.value.trim() && this.ageKeys().length === 0 && !this.unencrypted.value) {
      problems['age'] = msg('regie.server.backup.offsiteAgeRequired');
    }
    return problems;
  }

  private showFailure(error: ApiError): void {
    const refused: Partial<Record<Field, Msg>> = {};
    for (const [key, codes] of Object.entries(error.fieldErrors)) {
      const code = codes[0];
      switch (key.replace(/\[\d+\]$/, '')) {
        case 'schedule':
          refused['schedule'] = msg('regie.server.backup.scheduleInvalid');
          break;
        case 'timezone':
          refused['timezone'] = msg('regie.server.backup.timezoneInvalid');
          break;
        case 'keepDaily':
          refused['keepDaily'] = msg('regie.server.backup.keepInvalid', {
            min: 1,
            max: MAX_KEEP_DAILY,
          });
          break;
        case 'keepWeekly':
          refused['keepWeekly'] = msg('regie.server.backup.keepInvalid', {
            min: 1,
            max: MAX_KEEP_WEEKLY,
          });
          break;
        case 'rcloneRemote':
          refused['remote'] = msg(
            code === CODES.remoteNotInConfig
              ? 'regie.server.backup.offsiteRemoteNotInConfig'
              : 'regie.server.backup.offsiteRemoteInvalid',
          );
          break;
        case 'rcloneConfig':
          refused['config'] = msg('regie.server.backup.offsiteConfigInvalid');
          break;
        case 'ageRecipients': {
          const index = fieldIndex(key);
          refused['age'] =
            index === null
              ? msg('regie.server.backup.offsiteAgeRequired')
              : msg('regie.server.backup.offsiteAgeInvalid', { line: index + 1 });
          break;
        }
      }
    }
    if (Object.keys(refused).length === 0) {
      this.error.set(toUserMsg(error));
      return;
    }
    this.refused.set(refused);
    focusFirstInvalid(this.host, this.injector);
  }
}
