import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import {
  ITEM_BOUNDS,
  ROTATIONS,
  isHexColor,
  snapRotation,
  type ItemFit,
  type SceneItemDto,
} from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { IconComponent } from '../../core/ui/icon.component';
import { EditorService } from '../../stage/editor.service';
import { NumberFieldDirective } from '../shared/number-field.directive';
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

/**
 * Element inspector (prototype `renderInspector` with a selection): position, size, fit, corners and mirror,
 * rotation, crop per side in percent, border, behaviour on loss ("On failure", "Fallback source"), layer order and
 * "Remove from scene". Every change goes through `EditorService.updateItem`, which clamps to the server bounds,
 * shows it immediately and sends it coalesced. A number field is one undo step from focus to blur (prototype
 * `focusin` → `pushUndo`). Everything is disabled while the scene is live in Studio Mode or the Regie is offline.
 */
@Component({
  selector: 'sf-element-inspector',
  imports: [IconComponent, NumberFieldDirective],
  templateUrl: './element-inspector.component.html',
  styleUrl: './element-inspector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElementInspectorComponent {
  /** The selected item (with local drafts). */
  readonly item = input.required<SceneItemDto>();

  protected readonly editor = inject(EditorService);
  private readonly store = inject(ProductionStoreService);

  protected readonly t = t;
  protected readonly bounds = ITEM_BOUNDS;
  protected readonly rotations = ROTATIONS;
  protected readonly cropSides = CROP_SIDES;
  protected readonly maxCrop = MAX_CROP_PERCENT;

  protected readonly disabled = computed(() => !this.editor.canEdit());
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
