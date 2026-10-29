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
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { browserTimeZone, formatWeekday, msg, t, tm, type Msg } from '@studioflow/i18n';
import { SETTINGS_FIELD_ERROR_CODES as CODES } from '@studioflow/scene-model';
import { ApiError, toUserMsg } from '../core/api/api-error';
import { ClockService } from '../core/ui/clock.service';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { RefusedFields, focusFirstInvalid } from '../core/ui/form-feedback';
import { applyProblem, plainProblem, type ServerProblem } from './apply-messages';
import {
  WEEKDAYS,
  isScheduleTime,
  nextRun,
  parseSchedule,
  scheduleCron,
  timeZoneOptions,
  type SchedulePreset,
  type ScheduleParts,
} from './backup-schedule';
import { ServerProblemComponent } from './server-problem.component';
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

const PRESETS: readonly SchedulePreset[] = ['off', 'daily', 'weekly', 'custom'];

function wholeNumberIn(value: number | null, max: number): boolean {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= max;
}

/**
 * The backup schedule, retention and off-site copy (issue #27), on the page "Backups": when automatic backups run (Off,
 * Daily at a time, Weekly on a day at a time, or a cron expression of one's own, with a "Next backup …" preview and the
 * time zone, which defaults to this browser's), how many daily and weekly backups are kept, and, behind a switch, where
 * an encrypted copy goes (an rclone remote with its configuration, and the public age keys that encrypt it). The API
 * keeps one cron expression; the configuration is stored encrypted and never shown again. The backup service reads the
 * settings from a shared volume within seconds.
 */
@Component({
  selector: 'sf-backup-section',
  imports: [ReactiveFormsModule, ServerProblemComponent],
  templateUrl: './backup-section.component.html',
  styleUrls: ['./server-section.scss', './backup-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupSectionComponent {
  private readonly settings = inject(ServerSettingsService);
  private readonly clock = inject(ClockService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly refused = new RefusedFields<Field>();
  private readonly current = this.settings.settings()?.backup;
  private readonly stored = parseSchedule(this.current?.schedule);

  /** Emitted after the settings are saved. */
  readonly saved = output<void>();

  protected readonly t = t;
  protected readonly limits = { daily: MAX_KEEP_DAILY, weekly: MAX_KEEP_WEEKLY };
  protected readonly presets = PRESETS;
  protected readonly weekdays = WEEKDAYS;
  protected readonly preset = signal<SchedulePreset>(this.stored.preset);
  protected readonly time = new FormControl(this.stored.time, { nonNullable: true });
  protected readonly day = new FormControl(this.stored.day, { nonNullable: true });
  protected readonly cron = new FormControl(this.stored.cron, { nonNullable: true });
  /** A stored zone stays; a schedule that never had one starts with the zone of this browser (null meant UTC). */
  protected readonly timezone = new FormControl(
    this.current?.timezone ?? (this.current?.schedule ? 'UTC' : browserTimeZone()),
    { nonNullable: true },
  );
  protected readonly zones = timeZoneOptions([this.timezone.value]);
  protected readonly keepDaily = new FormControl<number | null>(this.current?.keepDaily ?? 7);
  protected readonly keepWeekly = new FormControl<number | null>(this.current?.keepWeekly ?? 4);
  /** The off-site copy is on (a remote is set). */
  protected readonly offsite = new FormControl(Boolean(this.current?.rcloneRemote), {
    nonNullable: true,
  });
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
  protected readonly offsiteOn = toSignal(this.offsite.valueChanges, {
    initialValue: this.offsite.value,
  });
  protected readonly saving = signal(false);
  protected readonly problem = signal<ServerProblem | null>(null);
  /** Saved, but the backup service has not read it yet: a notice, not a failure. */
  protected readonly notice = signal<ServerProblem | null>(null);

  private readonly typedTime = toSignal(this.time.valueChanges, { initialValue: this.time.value });
  private readonly typedDay = toSignal(this.day.valueChanges, { initialValue: this.day.value });
  private readonly typedZone = toSignal(this.timezone.valueChanges, {
    initialValue: this.timezone.value,
  });
  /** "Next backup tomorrow at 03:00." for a daily or weekly schedule; a sentence for off and custom. */
  protected readonly preview = computed(() => {
    const preset = this.preset();
    if (preset === 'off') {
      return t('regie.server.backup.nextOff');
    }
    if (preset === 'custom') {
      return t('regie.server.backup.nextCustom');
    }
    // Recomputed once a minute with the shared clock, so "today" turns into "tomorrow" in time.
    const now = new Date(Math.floor(this.clock.now() / 60_000) * 60_000);
    const next = nextRun(
      this.parts(this.typedTime(), Number(this.typedDay())),
      this.typedZone(),
      now,
    );
    if (!next) {
      return null;
    }
    if (next.daysAhead === 0) {
      return t('regie.server.backup.nextToday', { time: next.time });
    }
    if (next.daysAhead === 1) {
      return t('regie.server.backup.nextTomorrow', { time: next.time });
    }
    return t('regie.server.backup.nextDay', { day: formatWeekday(next.day), time: next.time });
  });

  constructor() {
    const watched: [Field, FormControl][] = [
      ['schedule', this.cron],
      ['schedule', this.time],
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
    this.offsite.valueChanges.subscribe(() => {
      this.refused.clear('remote');
      this.refused.clear('age');
    });
  }

  protected presetLabel(preset: SchedulePreset): string {
    switch (preset) {
      case 'off':
        return t('regie.server.backup.presetOff');
      case 'daily':
        return t('regie.server.backup.presetDaily');
      case 'weekly':
        return t('regie.server.backup.presetWeekly');
      case 'custom':
        return t('regie.server.backup.presetCustom');
    }
  }

  protected dayName(day: number): string {
    return formatWeekday(day);
  }

  protected choosePreset(preset: SchedulePreset): void {
    if (preset === 'custom' && this.preset() !== 'custom') {
      // Start from what the presets would have saved, so the cron field is never a blank puzzle.
      this.cron.setValue(scheduleCron(this.parts()) ?? '0 3 * * *');
    }
    this.preset.set(preset);
    this.refused.clear('schedule');
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
    const offsite = this.offsite.value;
    this.problem.set(null);
    this.notice.set(null);
    this.saving.set(true);
    try {
      await this.settings.saveBackup({
        schedule: scheduleCron(this.parts()),
        timezone: this.preset() === 'off' ? (this.current?.timezone ?? null) : this.timezone.value,
        keepDaily: this.keepDaily.value ?? 0,
        keepWeekly: this.keepWeekly.value ?? 0,
        rcloneRemote: offsite ? this.remote.value.trim() || null : null,
        rcloneConfig: offsite && this.config.value.trim() ? this.config.value : null,
        ageRecipients: offsite ? this.ageKeys() : [],
        offsiteUnencrypted: offsite && this.unencrypted.value,
      });
      this.config.reset('', { emitEvent: false });
      const outcome = await this.settings.waitUntilApplied(['backup'], BACKUP_APPLY_MS);
      if (!outcome.applied) {
        // The settings are saved; the service picks them up when it runs. No reason to fail the form.
        this.notice.set(
          outcome.failed.length > 0
            ? applyProblem(outcome)
            : { message: msg('regie.server.apply.backup'), command: 'docker compose ps backup' },
        );
      }
      this.saved.emit();
    } catch (error) {
      this.showFailure(ApiError.from(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** The schedule in the parts the form edits now. */
  private parts(time = this.time.value, day = Number(this.day.value)): ScheduleParts {
    return { preset: this.preset(), time, day, cron: this.cron.value };
  }

  private ageKeys(): string[] {
    return textLines(this.age.value)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private check(): Partial<Record<Field, Msg>> {
    const problems: Partial<Record<Field, Msg>> = {};
    const preset = this.preset();
    if ((preset === 'daily' || preset === 'weekly') && !isScheduleTime(this.time.value)) {
      problems['schedule'] = msg('regie.server.backup.timeInvalid');
    } else if (preset === 'custom' && !this.cron.value.trim()) {
      problems['schedule'] = msg('regie.server.backup.scheduleInvalid');
    }
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
    if (!this.offsite.value) {
      return problems;
    }
    if (!this.remote.value.trim()) {
      problems['remote'] = msg('regie.server.backup.offsiteRemoteRequired');
    }
    const badKey = firstInvalidLine(textLines(this.age.value), isAgeKey);
    if (badKey !== null) {
      problems['age'] = msg('regie.server.backup.offsiteAgeInvalid', { line: badKey });
    } else if (this.ageKeys().length > MAX_AGE_KEYS) {
      problems['age'] = msg('regie.server.backup.offsiteAgeInvalid', { line: MAX_AGE_KEYS + 1 });
    } else if (this.ageKeys().length === 0 && !this.unencrypted.value) {
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
      this.problem.set(plainProblem(toUserMsg(error)));
      return;
    }
    this.refused.set(refused);
    focusFirstInvalid(this.host, this.injector);
  }
}
