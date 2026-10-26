import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { countCharacters, t } from '@studioflow/i18n';
import {
  TEXT_LIMITS,
  TEXT_STYLES,
  defaultTextAlign,
  styleHasAlignment,
  type SceneItemDto,
  type TextAlign,
  type TextSourceDto,
  type TextStyle,
} from '@studioflow/scene-model';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { EditorService } from '../../stage/editor.service';
import { TextPreviewComponent } from './text-preview.component';

/** Typing pauses this long before the text is sent; leaving a field or choosing a style sends it at once. */
const SEND_DELAY_MS = 250;

const ALIGNMENTS: readonly TextAlign[] = ['left', 'center', 'right'];

/** The editable fields of a text. */
interface TextDraft {
  readonly line1: string;
  readonly line2: string;
  readonly style: TextStyle;
  readonly align: TextAlign;
}

function draftOf(text: TextSourceDto): TextDraft {
  return { line1: text.line1, line2: text.line2 ?? '', style: text.style, align: text.align };
}

function sameDraft(a: TextDraft, b: TextDraft): boolean {
  return a.line1 === b.line1 && a.line2 === b.line2 && a.style === b.style && a.align === b.align;
}

/**
 * Editor of one text or lower third in the Properties dock (issue #13): a live preview with the production colours,
 * the show/hide button, the two lines with a character counter, the style and the alignment. Typing is sent to the API
 * after a short pause (one request at a time, the newest state wins), so the output follows within a moment; the
 * preview shows what was typed at once. The text itself is shared by every scene that shows it. "Delete text" removes
 * it from all scenes after a confirmation.
 */
@Component({
  selector: 'sf-text-editor',
  imports: [ConfirmBoxComponent, IconComponent, TextPreviewComponent],
  templateUrl: './text-editor.component.html',
  styleUrl: './text-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextEditorComponent {
  /** The scene item that shows the text. */
  readonly item = input.required<SceneItemDto>();
  /** The saved content of the text. */
  readonly text = input.required<TextSourceDto>();

  private readonly api = inject(StudioApiService);
  private readonly store = inject(ProductionStoreService);
  private readonly editor = inject(EditorService);
  private readonly toasts = inject(ToastService);

  protected readonly t = t;
  protected readonly styles = TEXT_STYLES;
  protected readonly alignments = ALIGNMENTS;
  protected readonly lineMax = TEXT_LIMITS.lineLength;
  protected readonly draft = signal<TextDraft>({
    line1: '',
    line2: '',
    style: 'lowerThird',
    align: 'left',
  });
  protected readonly confirming = signal(false);
  protected readonly busy = signal(false);

  protected readonly disabled = computed(() => !this.store.canCommand());
  protected readonly line1Empty = computed(() => this.draft().line1.trim() === '');
  protected readonly line1Count = computed(() => countCharacters(this.draft().line1));
  protected readonly line2Count = computed(() => countCharacters(this.draft().line2));
  /** A line is longer than the API accepts: the counter turns red and nothing is sent. */
  protected readonly tooLong = computed(
    () => this.line1Count() > TEXT_LIMITS.lineLength || this.line2Count() > TEXT_LIMITS.lineLength,
  );
  protected readonly hasAlignment = computed(() => styleHasAlignment(this.draft().style));
  /** The draft as the content the preview draws. */
  protected readonly preview = computed<TextSourceDto>(() => {
    const { line1, line2, style, align } = this.draft();
    const text = this.text();
    return { ...text, line1, line2: line2.trim() === '' ? null : line2, style, align };
  });
  protected readonly shown = computed(() => !this.item().hidden);
  /** Scenes that show the text: a change applies to all of them. */
  protected readonly sharedCount = computed(
    () =>
      this.store
        .scenes()
        .filter((scene) => scene.items.some((item) => item.source === this.text().id)).length,
  );
  protected readonly deleteMessage = computed(() =>
    t('regie.text.delete.message', { code: this.text().code, count: this.sharedCount() }),
  );

  /** Content that was typed and is not saved yet. */
  private unsent = false;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Show the saved content again (a change from another Regie, the server's normalisation) unless typing is pending.
    effect(() => {
      const saved = draftOf(this.text());
      untracked(() => {
        if (!this.unsent && !this.inFlight && !sameDraft(this.draft(), saved)) {
          this.draft.set(saved);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => this.flush());
  }

  protected setLine(line: 'line1' | 'line2', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((draft) => ({ ...draft, [line]: value }));
    this.unsent = true;
    this.schedule();
  }

  protected setStyle(style: TextStyle): void {
    if (this.draft().style === style) {
      return;
    }
    // A new style starts with its usual alignment (titles are centred).
    this.draft.update((draft) => ({ ...draft, style, align: defaultTextAlign(style) }));
    this.unsent = true;
    this.flush();
  }

  protected setAlign(align: TextAlign): void {
    if (this.draft().align === align) {
      return;
    }
    this.draft.update((draft) => ({ ...draft, align }));
    this.unsent = true;
    this.flush();
  }

  protected toggleShown(): void {
    this.editor.toggleHidden(this.item().id);
  }

  /** Leaving a field sends what was typed at once. */
  protected onBlur(): void {
    this.flush();
  }

  protected askDelete(): void {
    this.confirming.set(true);
  }

  protected async deleteText(): Promise<void> {
    const productionId = this.store.productionId();
    if (!productionId || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.unsent = false;
    this.clearTimer();
    try {
      await this.api.deleteText(productionId, this.text().id);
      this.toasts.show(t('regie.text.delete.toast', { code: this.text().code }));
    } catch (error) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
      this.confirming.set(false);
    }
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.flush(), SEND_DELAY_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Sends the draft when something is unsent; a request in flight sends the newest state again when it returns. An
   * empty first line or a line that is too long is never sent (the API would refuse it), the field shows why.
   */
  private flush(): void {
    this.clearTimer();
    const productionId = this.store.productionId();
    if (!this.unsent || this.inFlight || !productionId || this.line1Empty() || this.tooLong()) {
      return;
    }
    const { line1, line2, style, align } = this.draft();
    this.unsent = false;
    this.inFlight = true;
    this.api
      .updateText(productionId, this.text().id, {
        line1,
        line2: line2.trim() === '' ? null : line2,
        style,
        align,
      })
      .then(() => {
        this.inFlight = false;
        // Typing went on while the request ran: send the newest state now.
        if (this.unsent && this.timer === null) {
          this.flush();
        }
      })
      .catch((error: unknown) => {
        // Not sent again by itself: the next edit sends the draft, and a refusal is shown once.
        this.inFlight = false;
        this.unsent = true;
        this.toasts.error(error);
      });
  }
}
