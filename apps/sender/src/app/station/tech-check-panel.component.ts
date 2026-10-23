import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { t } from '@studioflow/i18n';
import { techProblemText, type TechCheckResult } from '@studioflow/media-client/device';
import {
  formatHm,
  formatKbpsAsMbit,
  type TechCheckDto,
  type TechCheckLevel,
} from '@studioflow/scene-model';
import { IconComponent } from '../shared/icon.component';
import { LanguageSelectComponent } from '../shared/language-select.component';

/** One lamp of the check. */
interface CheckRow {
  readonly key: 'camera' | 'network' | 'bandwidth';
  readonly level: TechCheckLevel;
  readonly value: string | null;
}

const LEVEL_LAMPS: Readonly<Record<TechCheckLevel, string>> = {
  ok: 'c-lamp',
  warn: 'c-lamp c-lamp--warn',
  bad: 'c-lamp c-lamp--bad',
  unknown: 'c-lamp c-lamp--idle',
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

/** “Tech check”: camera, network and upload as lamps, with the problems and “Check again”. */
@Component({
  selector: 'sf-tech-check-panel',
  imports: [IconComponent, LanguageSelectComponent],
  templateUrl: './tech-check-panel.component.html',
  styleUrl: './tech-check-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechCheckPanelComponent {
  readonly result = input<TechCheckResult | null>(null);
  readonly running = input(false);
  /** The device has a camera slot (else the camera lamp is left out). */
  readonly withCamera = input(true);
  readonly run = output<void>();
  readonly closed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly t = t;
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

  constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('h2')?.focus());
  }
}
