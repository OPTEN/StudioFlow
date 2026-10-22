import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  output,
} from '@angular/core';
import type { SourceDto } from '@flowstudio/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { PopoverDirective, PopoverService } from '../../core/ui/popover.directive';
import { EditorService, LIVE_LOCKED_MESSAGE } from '../../stage/editor.service';
import { keepInViewport } from '../shared/keep-in-viewport';
import { handleMenuKeys } from '../shared/menu-keys';
import { KIND_ICON, sourceStateView, toneClass } from '../shared/source-view';
import { addableSourceGroups } from './source-rows';

/** Id of the «+ Quelle» popover. */
export const ADD_SOURCE_POPOVER = 'add-source';

/**
 * The «+ Quelle» menu (prototype `renderAddSource`): every source that is not yet in the edit scene and not blocked,
 * grouped into Kameras, Screens and Medien, plus «Bild oder Video hochladen …» and «Medien verwalten …» (both open
 * the media popover). Choosing a source adds it with the default geometry and selects it (`EditorService.addSource`).
 * While the scene is live in Studio-Modus or the Regie is offline the sources are disabled with a note.
 */
@Component({
  selector: 'fs-add-source-popover',
  imports: [IconComponent, PopoverDirective],
  templateUrl: './add-source-popover.component.html',
  styleUrl: './add-source-popover.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddSourcePopoverComponent {
  /** «Bild oder Video hochladen …»: the dock opens the media popover with the file picker. */
  readonly upload = output<void>();
  /** «Medien verwalten …»: the dock opens the media popover. */
  readonly manage = output<void>();

  protected readonly store = inject(ProductionStoreService);
  private readonly editor = inject(EditorService);
  private readonly popovers = inject(PopoverService);

  protected readonly popoverId = ADD_SOURCE_POPOVER;
  protected readonly lockedMessage = LIVE_LOCKED_MESSAGE;
  protected readonly sceneName = computed(() => this.editor.editScene()?.name ?? 'Szene');
  protected readonly locked = this.editor.editLocked;
  protected readonly canAdd = this.editor.canEdit;
  protected readonly offline = computed(() => !this.store.canCommand());
  protected readonly groups = computed(() => {
    const scene = this.editor.editScene();
    return scene ? addableSourceGroups(scene, this.store.sources()) : [];
  });
  protected readonly hasSources = computed(() => this.store.sources().size > 0);
  protected readonly hasMedia = computed(() => this.store.assets().size > 0);

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    // Keep the menu inside the window when the dock sits low on the screen or in the left zone.
    afterNextRender(() => {
      const panel = element.querySelector<HTMLElement>('.c-pop');
      if (panel) {
        keepInViewport(panel);
      }
    });
  }

  protected icon(source: SourceDto): (typeof KIND_ICON)[keyof typeof KIND_ICON] {
    return KIND_ICON[source.kind];
  }

  protected stateOf(source: SourceDto): { word: string; className: string } | null {
    const state = sourceStateView(source);
    return state ? { word: state.word, className: toneClass(state.tone) } : null;
  }

  protected add(source: SourceDto): void {
    this.popovers.close(this.popoverId);
    this.editor.addSource(source.id);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    handleMenuKeys(event, event.currentTarget as HTMLElement);
  }
}
