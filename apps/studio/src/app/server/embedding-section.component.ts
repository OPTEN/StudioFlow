import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { msg, t, tm, type Msg } from '@studioflow/i18n';
import { SETTINGS_FIELD_ERROR_CODES as CODES } from '@studioflow/scene-model';
import { ApiError, toUserMsg } from '../core/api/api-error';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { focusFirstInvalid } from '../core/ui/form-feedback';
import { IconComponent } from '../core/ui/icon.component';
import { applyProblem, plainProblem, type ServerProblem } from './apply-messages';
import { ServerProblemComponent } from './server-problem.component';
import { MAX_ORIGINS, fieldIndex, isOrigin } from './server-rules';

/** One website of the list; the id keeps focus and messages on the right row while rows come and go. */
interface OriginRow {
  readonly id: number;
  readonly value: string;
}

/**
 * Embedding the output (issue #27): the websites whose pages may show the output in a frame (`frame-ancestors` of the
 * output pages, for example a streaming proxy). An editable list: one row per website with its own check when it is
 * left, "Add website" and a remove button per row; empty rows are ignored. The API takes the list as `origins`. The
 * control room itself is never embeddable. The same section is the last step of the first-run wizard and the page
 * "Embedding" of the settings window.
 */
@Component({
  selector: 'sf-embedding-section',
  imports: [IconComponent, ServerProblemComponent],
  templateUrl: './embedding-section.component.html',
  styleUrls: ['./server-section.scss', './embedding-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmbeddingSectionComponent {
  private readonly settings = inject(ServerSettingsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private nextId = 0;

  /** `next`: the last step of the wizard; `save`: the settings page. */
  readonly mode = input<'save' | 'next'>('save');
  /** Emitted after the websites are saved and Caddy runs them. */
  readonly saved = output<void>();

  protected readonly t = t;
  protected readonly max = MAX_ORIGINS;
  protected readonly rows = signal<readonly OriginRow[]>(
    (this.settings.settings()?.embedding.origins ?? []).map((value) => this.row(value)),
  );
  /** The message of each row that is not a website address, by row id. */
  private readonly rowProblems = signal<ReadonlyMap<number, Msg>>(new Map());
  /** A problem with the list as a whole (too many). */
  protected readonly listProblem = signal<Msg | null>(null);
  protected readonly listProblemText = computed(() => tm(this.listProblem()) || null);
  protected readonly saving = signal(false);
  protected readonly problem = signal<ServerProblem | null>(null);
  protected readonly atLimit = computed(() => this.rows().length >= MAX_ORIGINS);

  protected rowError(id: number): string | null {
    const message = this.rowProblems().get(id);
    return message ? tm(message) : null;
  }

  protected edit(id: number, value: string): void {
    this.rows.update((rows) => rows.map((row) => (row.id === id ? { ...row, value } : row)));
    this.setRowProblem(id, null);
    this.listProblem.set(null);
  }

  /** A row is checked as soon as it is left, like the other forms. */
  protected leave(id: number): void {
    const row = this.rows().find((candidate) => candidate.id === id);
    if (row && row.value.trim() && !isOrigin(row.value)) {
      this.setRowProblem(id, msg('regie.server.embedding.invalid'));
    }
  }

  protected add(): void {
    if (this.atLimit()) {
      return;
    }
    const row = this.row('');
    this.rows.update((rows) => [...rows, row]);
    afterNextRender(() => this.inputOf(row.id)?.focus(), { injector: this.injector });
  }

  protected remove(id: number): void {
    const rows = this.rows();
    const index = rows.findIndex((row) => row.id === id);
    const next = rows[index + 1] ?? rows[index - 1] ?? null;
    this.rows.set(rows.filter((row) => row.id !== id));
    this.setRowProblem(id, null);
    this.listProblem.set(null);
    // The focus stays in the list: on the row that took the place, else on "Add website".
    afterNextRender(
      () =>
        (next
          ? this.inputOf(next.id)
          : this.host.nativeElement.querySelector<HTMLElement>('[data-add]')
        )?.focus(),
      { injector: this.injector },
    );
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) {
      return;
    }
    const filled = this.rows().filter((row) => row.value.trim().length > 0);
    const problems = new Map<number, Msg>();
    for (const row of filled) {
      if (!isOrigin(row.value)) {
        problems.set(row.id, msg('regie.server.embedding.invalid'));
      }
    }
    this.rowProblems.set(problems);
    if (problems.size > 0) {
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    if (filled.length > MAX_ORIGINS) {
      this.listProblem.set(msg('regie.server.embedding.tooMany', { max: MAX_ORIGINS }));
      return;
    }
    this.problem.set(null);
    this.saving.set(true);
    try {
      await this.settings.saveEmbedding({ origins: filled.map((row) => row.value.trim()) });
      const outcome = await this.settings.waitUntilApplied(['caddy']);
      if (!outcome.applied) {
        this.problem.set(applyProblem(outcome));
        return;
      }
      // Empty rows have done their job.
      this.rows.set(filled.map((row) => ({ ...row, value: row.value.trim() })));
      this.saved.emit();
    } catch (error) {
      this.showFailure(ApiError.from(error), filled);
    } finally {
      this.saving.set(false);
    }
  }

  private showFailure(error: ApiError, sent: readonly OriginRow[]): void {
    for (const [key, codes] of Object.entries(error.fieldErrors)) {
      const index = fieldIndex(key);
      const row = index === null ? undefined : sent[index];
      if (key.startsWith('origins') && codes.includes(CODES.originInvalid) && row) {
        this.setRowProblem(row.id, msg('regie.server.embedding.invalid'));
        focusFirstInvalid(this.host, this.injector);
        return;
      }
      if (key === 'origins' && codes.includes(CODES.tooManyOrigins)) {
        this.listProblem.set(msg('regie.server.embedding.tooMany', { max: MAX_ORIGINS }));
        return;
      }
    }
    this.problem.set(plainProblem(toUserMsg(error)));
  }

  private setRowProblem(id: number, message: Msg | null): void {
    if (message === null && !this.rowProblems().has(id)) {
      return;
    }
    this.rowProblems.update((problems) => {
      const next = new Map(problems);
      if (message === null) {
        next.delete(id);
      } else {
        next.set(id, message);
      }
      return next;
    });
  }

  private inputOf(id: number): HTMLInputElement | null {
    return this.host.nativeElement.querySelector<HTMLInputElement>(`#embedding-origin-${id}`);
  }

  private row(value: string): OriginRow {
    return { id: this.nextId++, value };
  }
}
