import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { msg, t, tm, type Msg } from '@studioflow/i18n';
import { SETTINGS_FIELD_ERROR_CODES as CODES } from '@studioflow/scene-model';
import { ApiError, toUserMsg } from '../core/api/api-error';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { focusFirstInvalid } from '../core/ui/form-feedback';
import { applyFailureMsg } from './apply-messages';
import {
  MAX_ORIGINS,
  fieldIndex,
  filledLines,
  firstInvalidLine,
  isOrigin,
  textLines,
} from './server-rules';

/**
 * Embedding the output (issue #27): the origins whose web pages may show the output in a frame (`frame-ancestors` of the
 * output pages, for a streaming proxy). One origin per line. The control room itself is never embeddable. The same
 * section is a step of the first-run wizard and a part of the "Server settings" page.
 */
@Component({
  selector: 'sf-embedding-section',
  imports: [ReactiveFormsModule],
  templateUrl: './embedding-section.component.html',
  styleUrl: './server-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmbeddingSectionComponent {
  private readonly settings = inject(ServerSettingsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** `next`: the last step of the wizard; `save`: the settings page. */
  readonly mode = input<'save' | 'next'>('save');
  /** Emitted after the origins are saved and Caddy runs them. */
  readonly saved = output<void>();

  protected readonly t = t;
  protected readonly origins = new FormControl(
    (this.settings.settings()?.embedding.origins ?? []).join('\n'),
    { nonNullable: true },
  );
  protected readonly saving = signal(false);
  protected readonly problem = signal<Msg | null>(null);
  protected readonly problemText = computed(() => tm(this.problem()) || null);
  protected readonly error = signal<Msg | null>(null);
  protected readonly errorText = computed(() => tm(this.error()) || null);

  constructor() {
    this.origins.valueChanges.subscribe(() => this.problem.set(null));
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) {
      return;
    }
    const lines = textLines(this.origins.value);
    const bad = firstInvalidLine(lines, isOrigin);
    if (bad !== null) {
      this.problem.set(msg('regie.server.embedding.invalid', { line: bad }));
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    if (filledLines(lines) > MAX_ORIGINS) {
      this.problem.set(msg('regie.server.embedding.tooMany', { max: MAX_ORIGINS }));
      focusFirstInvalid(this.host, this.injector);
      return;
    }
    this.error.set(null);
    this.saving.set(true);
    try {
      await this.settings.saveEmbedding({ origins: lines });
      const outcome = await this.settings.waitUntilApplied(['caddy']);
      if (!outcome.applied) {
        this.error.set(applyFailureMsg(outcome));
        return;
      }
      this.saved.emit();
    } catch (error) {
      this.showFailure(ApiError.from(error));
    } finally {
      this.saving.set(false);
    }
  }

  private showFailure(error: ApiError): void {
    for (const [key, codes] of Object.entries(error.fieldErrors)) {
      const index = fieldIndex(key);
      if (key.startsWith('origins') && codes.includes(CODES.originInvalid) && index !== null) {
        this.problem.set(msg('regie.server.embedding.invalid', { line: index + 1 }));
        focusFirstInvalid(this.host, this.injector);
        return;
      }
      if (key === 'origins' && codes.includes(CODES.tooManyOrigins)) {
        this.problem.set(msg('regie.server.embedding.tooMany', { max: MAX_ORIGINS }));
        focusFirstInvalid(this.host, this.injector);
        return;
      }
    }
    this.error.set(toUserMsg(error));
  }
}
