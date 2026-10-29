import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { t, type PlainMessageKey } from '@studioflow/i18n';
import {
  ITEM_BOUNDS,
  ROTATIONS,
  isHexColor,
  snapRotation,
  type ItemFit,
  type SceneItemDto,
} from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { EditorService } from '../../stage/editor.service';
import { NumberFieldDirective } from '../shared/number-field.directive';
import { InspectorSectionComponent } from './inspector-section.component';
import { InspectorSectionsService, type InspectorTab } from './inspector-sections.service';
import { TextEditorComponent } from './text-editor.component';
import {
  CROP_SIDES,
  MAX_CROP_PERCENT,
  cropToPercent,
  fallbackGroups,
  hasCrop,
  holdChoices,
  holdValue,
  parseHoldValue,
  withBorderEnabled,
  withCropPercent,
  withoutCrop,
  type CropSide,
} from './inspector-math';

/** Numeric item fields edited with a number field. */
type NumberKey = 'x' | 'y' | 'w' | 'h' | 'radius';

const TAB_LABEL: Readonly<Record<InspectorTab, PlainMessageKey>> = {
  text: 'regie.properties.tabs.text',
  layout: 'regie.properties.tabs.layout',
  style: 'regie.properties.tabs.style',
  failure: 'regie.properties.tabs.failure',
};

/**
 * Element inspector in tabs, so a narrow dock shows one job at a time (the dock head above keeps the item's name and
 * its Live / Preview state in view). A text or lower third has "Text" (its editor, first) and "Layout"; a picture has
 * "Layout" (the collapsible sections "Position & size" with the canvas size as reference, "Fit & crop" and "Layer"),
 * "Style" (corners, rotation, mirror, border) and "When it fails" (first the last picture for a while, then a
 * fallback source or the dimmed picture). The chosen tab is kept while other items are selected; ←/→ move between
 * the tabs. All panels stay rendered (hidden), so a running text edit or a number field keeps its state. The destructive
 * actions close the inspector: "Remove from scene" and, for a text, "Delete text…" (from every scene, behind a
 * confirmation). Every change goes through `EditorService.updateItem`, which clamps to the server bounds, shows it
 * immediately and sends it coalesced. A number field is one undo step from focus to blur. Everything is disabled while
 * the scene is live in Studio Mode or the Regie is offline (the dock's status line says why).
 */
@Component({
  selector: 'sf-element-inspector',
  imports: [
    ConfirmBoxComponent,
    InspectorSectionComponent,
    NumberFieldDirective,
    TextEditorComponent,
  ],
  templateUrl: './element-inspector.component.html',
  styleUrl: './element-inspector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElementInspectorComponent {
  /** The selected item (with local drafts). */
  readonly item = input.required<SceneItemDto>();

  protected readonly editor = inject(EditorService);
  private readonly store = inject(ProductionStoreService);
  private readonly sections = inject(InspectorSectionsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly t = t;
  protected readonly bounds = ITEM_BOUNDS;
  protected readonly rotations = ROTATIONS;
  protected readonly cropSides = CROP_SIDES;
  protected readonly maxCrop = MAX_CROP_PERCENT;

  protected readonly tabLabel = TAB_LABEL;
  /** The tabs for this item: a text starts with its words, a picture has its style and failure behaviour. */
  protected readonly tabs = computed<readonly InspectorTab[]>(() =>
    this.text() ? ['text', 'layout'] : ['layout', 'style', 'failure'],
  );
  /** The chosen tab when this item has it, else the first one. */
  protected readonly activeTab = computed<InspectorTab>(() => {
    const chosen = this.sections.tab();
    const tabs = this.tabs();
    return chosen && tabs.includes(chosen) ? chosen : tabs[0];
  });

  /** The text editor of a text item; it owns "Delete text…", whose button sits in the footer. */
  protected readonly textEditor = viewChild(TextEditorComponent);

  protected readonly disabled = computed(() => !this.editor.canEdit());
  /** "Canvas 1920 × 1080": what the pixel values refer to. */
  protected readonly canvasNote = computed(() => {
    const { width, height } = this.store.canvas();
    return t('regie.properties.element.canvas', { width, height });
  });
  /** "Keep the last picture until the source is back": no fallback can follow. */
  protected readonly holdsForever = computed(() => this.item().onLost.holdMs === null);
  /** The content of the item's text; null for every other kind of source. */
  protected readonly text = computed(() => this.store.textOf(this.item().source) ?? null);
  protected readonly rotation = computed(() => snapRotation(this.item().rotation));
  protected readonly cropped = computed(() => hasCrop(this.item()));
  protected readonly holdChoices = computed(() => holdChoices(this.item().onLost.holdMs));
  protected readonly holdValue = computed(() => holdValue(this.item().onLost.holdMs));
  protected readonly fallbackGroups = computed(() =>
    fallbackGroups(this.store.sources(), this.item().source),
  );
  /** A fallback that points to a deleted source is still shown, as "Source missing". */
  protected readonly fallbackMissing = computed(() => {
    const fallback = this.item().onLost.fallbackSource;
    return fallback !== null && !this.store.sourceById(fallback);
  });
  private readonly layerIndex = computed(() => {
    const items = this.editor.editScene()?.items ?? [];
    return { index: items.findIndex((entry) => entry.id === this.item().id), count: items.length };
  });
  protected readonly canFront = computed(() => {
    const { index, count } = this.layerIndex();
    return index >= 0 && index < count - 1;
  });
  protected readonly canBack = computed(() => this.layerIndex().index > 0);

  protected selectTab(tab: InspectorTab): void {
    this.sections.setTab(tab);
  }

  /** ←/→ (Home/End) move between the tabs and select them, like a native tab bar. */
  protected onTabKeyDown(event: KeyboardEvent): void {
    const tabs = this.tabs();
    const index = tabs.indexOf(this.activeTab());
    const next: Readonly<Record<string, number>> = {
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = next[event.key];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    this.selectTab(tabs[target]);
    this.host.querySelector<HTMLElement>(`#sf-insp-tab-${tabs[target]}`)?.focus();
  }

  protected cropPercent(side: CropSide): number {
    return cropToPercent(this.item().crop[side]);
  }

  /** Focus of a number field: everything typed until blur is one undo step. */
  protected beginEdit(): void {
    this.editor.beginGesture();
  }

  protected endEdit(): void {
    this.editor.endGesture();
  }

  protected setNumber(key: NumberKey, value: number): void {
    this.commit({ ...this.item(), [key]: value });
  }

  protected setCrop(side: CropSide, percent: number): void {
    this.commit(withCropPercent(this.item(), side, percent));
  }

  protected resetCrop(): void {
    this.commit(withoutCrop(this.item()));
  }

  protected setFit(fit: ItemFit): void {
    if (this.item().fit !== fit) {
      this.commit({ ...this.item(), fit });
    }
  }

  protected setRotation(rotation: number): void {
    if (this.rotation() !== rotation) {
      this.commit({ ...this.item(), rotation });
    }
  }

  protected setMirror(event: Event): void {
    this.commit({ ...this.item(), mirror: (event.target as HTMLInputElement).checked });
  }

  protected setBorderEnabled(event: Event): void {
    this.commit(withBorderEnabled(this.item(), (event.target as HTMLInputElement).checked));
  }

  protected setBorderWidth(width: number): void {
    const border = this.item().border;
    if (border) {
      this.commit({ ...this.item(), border: { ...border, width } });
    }
  }

  protected setBorderColor(event: Event): void {
    const border = this.item().border;
    const color = (event.target as HTMLInputElement).value;
    if (border && isHexColor(color) && color !== border.color) {
      this.commit({ ...this.item(), border: { ...border, color } });
    }
  }

  protected setHold(event: Event): void {
    const holdMs = parseHoldValue((event.target as HTMLSelectElement).value);
    if (holdMs !== undefined) {
      this.commit({ ...this.item(), onLost: { ...this.item().onLost, holdMs } });
    }
  }

  protected setFallback(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const fallbackSource = value === '' ? null : value;
    this.commit({ ...this.item(), onLost: { ...this.item().onLost, fallbackSource } });
  }

  protected moveLayer(direction: 'up' | 'down' | 'front' | 'back'): void {
    this.editor.moveLayer(this.item().id, direction);
  }

  protected remove(): void {
    this.editor.removeItem(this.item().id);
  }

  private commit(item: SceneItemDto): void {
    this.editor.updateItem(item);
  }
}
