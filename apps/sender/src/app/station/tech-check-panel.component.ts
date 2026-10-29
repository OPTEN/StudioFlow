import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { techProblemText, type TechCheckResult } from '@studioflow/media-client/device';
import {
  formatHm,
  formatKbpsAsMbit,
  type DeviceSelfDto,
  type TechCheckDto,
  type TechCheckLevel,
} from '@studioflow/scene-model';
import { APP_VERSION } from '../core/app-version';
import { IconComponent } from '../shared/icon.component';
import { LanguageSelectComponent } from '../shared/language-select.component';
import { SheetComponent } from '../shared/sheet.component';

/** One lamp of the check. */
interface CheckRow {
  readonly key: 'camera' | 'network' | 'bandwidth';
  readonly level: TechCheckLevel;
  readonly value: string | null;
}

/** The two parts of the sheet: the check itself and what this device is. */
type TechCheckTab = 'check' | 'device';

const LEVEL_LAMPS: Readonly<Record<TechCheckLevel, string>> = {
  ok: 'c-lamp',
  warn: 'c-lamp is-warn',
  bad: 'c-lamp is-bad',
  unknown: 'c-lamp is-idle',
};

/** Overall verdict of a check. */
export function techCheckSummary(result: TechCheckDto | null): string {
  return t(`sender.techcheck.summary.${result?.overall ?? 'unknown'}`);
}

/**
 * The problems of a check in the language of the reader. A check stored by an older version has no problems, only the
 * `note` (then in the language it was written in).
 */
export function techCheckNote(result: TechCheckResult | null): string | null {
  if (result === null) {
    return null;
  }
  return result.problems.length > 0
    ? result.problems.map((problem) => techProblemText(problem)).join(' ')
    : result.note;
}

/**
 * “Tech check” as a modal sheet in two tabs: “Check” with the verdict in plain words, camera, network and upload as
 * lamps with advice for what is limited and “Check again”; “This device” with its name, production, app version and
 * language. Arrow keys, Home and End move between the tabs; Escape closes the sheet.
 */
@Component({
  selector: 'sf-tech-check-panel',
  imports: [IconComponent, LanguageSelectComponent, SheetComponent],
  templateUrl: './tech-check-panel.component.html',
  styleUrl: './tech-check-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechCheckPanelComponent {
  readonly result = input<TechCheckResult | null>(null);
  readonly running = input(false);
  /** The device has a camera slot (else the camera lamp is left out). */
  readonly withCamera = input(true);
  /** This device as the server knows it (name and production in the “This device” group). */
  readonly device = input<DeviceSelfDto | null>(null);
  readonly run = output<void>();
  readonly closed = output<void>();

  protected readonly t = t;
  protected readonly version = APP_VERSION;
  protected readonly tabs: readonly TechCheckTab[] = ['check', 'device'];
  protected readonly active = signal<TechCheckTab>('check');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly level = computed(() => this.result()?.overall ?? 'unknown');
  protected readonly summary = computed(() => techCheckSummary(this.result()));
  protected readonly note = computed(() => techCheckNote(this.result()));
  protected readonly checkedAt = computed(() => {
    const at = this.result()?.at;
    return at === undefined ? null : formatHm(new Date(at));
  });

  protected readonly rows = computed<readonly CheckRow[]>(() => {
    const result = this.result();
    const rows: CheckRow[] = [
      {
        key: 'network',
        level: result?.network ?? 'unknown',
        value: result?.rttMs === null || result === null ? null : `${result.rttMs} ms`,
      },
      {
        key: 'bandwidth',
        level: result?.bandwidth ?? 'unknown',
        value:
          result?.uploadKbps === null || result === null
            ? null
            : `${formatKbpsAsMbit(result.uploadKbps)} Mbit/s`,
      },
    ];
    return this.withCamera()
      ? [{ key: 'camera', level: result?.camera ?? 'unknown', value: null }, ...rows]
      : rows;
  });

  protected readonly lampClass = (level: TechCheckLevel): string => LEVEL_LAMPS[level];

  /** Arrow keys, Home and End move between the tabs (automatic activation, like the Regie's tabs). */
  protected tabKey(event: KeyboardEvent): void {
    const index = this.tabs.indexOf(this.active());
    const last = this.tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % this.tabs.length
        : event.key === 'ArrowLeft'
          ? (index + last) % this.tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) {
      return;
    }
    event.preventDefault();
    const tab = this.tabs[next] ?? 'check';
    this.active.set(tab);
    this.host.querySelector<HTMLElement>(`#tech-check-tab-${tab}`)?.focus();
  }
}
