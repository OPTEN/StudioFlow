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
import {
  formatHm,
  formatKbpsAsMbit,
  type TechCheckDto,
  type TechCheckLevel,
} from '@studioflow/scene-model';
import { IconComponent } from '../shared/icon.component';

/** One lamp of the check. */
interface CheckRow {
  readonly key: 'camera' | 'network' | 'bandwidth';
  readonly label: string;
  readonly level: TechCheckLevel;
  readonly value: string | null;
}

const LEVEL_WORDS: Readonly<Record<TechCheckLevel, string>> = {
  ok: 'gut',
  warn: 'eingeschränkt',
  bad: 'ungenügend',
  unknown: 'nicht geprüft',
};

const LEVEL_LAMPS: Readonly<Record<TechCheckLevel, string>> = {
  ok: 'c-lamp',
  warn: 'c-lamp c-lamp--warn',
  bad: 'c-lamp c-lamp--bad',
  unknown: 'c-lamp c-lamp--idle',
};

/** Overall verdict of a check. */
export function techCheckSummary(result: TechCheckDto | null): string {
  switch (result?.overall) {
    case 'ok':
      return 'Alles bereit für die Sendung.';
    case 'warn':
      return 'Es geht, aber mit Einschränkungen.';
    case 'bad':
      return 'So gibt es Probleme in der Sendung.';
    default:
      return 'Noch nicht geprüft.';
  }
}

/** «Technik-Check»: camera, network and upload as lamps, with the German note and «Erneut prüfen». */
@Component({
  selector: 'sf-tech-check-panel',
  imports: [IconComponent],
  templateUrl: './tech-check-panel.component.html',
  styleUrl: './tech-check-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechCheckPanelComponent {
  readonly result = input<TechCheckDto | null>(null);
  readonly running = input(false);
  /** The device has a camera slot (else the camera lamp is left out). */
  readonly withCamera = input(true);
  readonly run = output<void>();
  readonly closed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly summary = computed(() => techCheckSummary(this.result()));
  protected readonly checkedAt = computed(() => {
    const at = this.result()?.at;
    return at === undefined ? null : formatHm(new Date(at));
  });

  protected readonly rows = computed<readonly CheckRow[]>(() => {
    const result = this.result();
    const rows: CheckRow[] = [
      {
        key: 'network',
        label: 'Netzwerk',
        level: result?.network ?? 'unknown',
        value: result?.rttMs === null || result === null ? null : `${result.rttMs} ms`,
      },
      {
        key: 'bandwidth',
        label: 'Upload',
        level: result?.bandwidth ?? 'unknown',
        value:
          result?.uploadKbps === null || result === null
            ? null
            : `${formatKbpsAsMbit(result.uploadKbps)} Mbit/s`,
      },
    ];
    return this.withCamera()
      ? [
          { key: 'camera', label: 'Kamera', level: result?.camera ?? 'unknown', value: null },
          ...rows,
        ]
      : rows;
  });

  protected readonly levelWord = (level: TechCheckLevel): string => LEVEL_WORDS[level];
  protected readonly lampClass = (level: TechCheckLevel): string => LEVEL_LAMPS[level];

  constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('h2')?.focus());
  }
}
