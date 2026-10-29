import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { t } from '@studioflow/i18n';
import { LIMITS, isHexColor, type LayoutTemplateId, type SceneDto } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { EditorService } from '../../stage/editor.service';
import { SwitcherService } from '../../stage/switcher.service';
import { SceneCommandsService } from '../scenes/scene-commands.service';
import { InspectorSectionComponent } from './inspector-section.component';
import { TemplatePickerComponent } from './template-picker.component';

/**
 * Scene inspector: the name, then the collapsible sections "Layout templates" (the eight templates as tiles, Auto grid
 * pressed and explained while active) and "Background" (colour with its hex value, optional image), and at the end
 * "Delete scene…" behind a confirmation. The live scene cannot be deleted (the hint says why and where other scenes are
 * deleted). The name is saved on Enter or when the field loses the focus; Escape restores it. Everything is disabled
 * while the scene is live in Studio Mode or the Regie is offline (the dock's status line says why).
 */
@Component({
  selector: 'sf-scene-inspector',
  imports: [
    ConfirmBoxComponent,
    InspectorSectionComponent,
    ReactiveFormsModule,
    TemplatePickerComponent,
  ],
  templateUrl: './scene-inspector.component.html',
  styleUrl: './scene-inspector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SceneInspectorComponent {
  /** The edit scene (with local drafts). */
  readonly scene = input.required<SceneDto>();

  protected readonly commands = inject(SceneCommandsService);
  private readonly editor = inject(EditorService);
  private readonly store = inject(ProductionStoreService);
  private readonly switcher = inject(SwitcherService);

  protected readonly t = t;
  protected readonly maxNameLength = LIMITS.sceneNameLength;
  protected readonly nameControl = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.maxLength(LIMITS.sceneNameLength),
      Validators.pattern(/\S/),
    ],
  });
  protected readonly confirming = signal(false);
  private readonly nameFocused = signal(false);

  protected readonly disabled = computed(() => !this.editor.canEdit());
  protected readonly isLiveScene = computed(() => this.scene().id === this.store.programSceneId());
  protected readonly autoGrid = computed(() => this.scene().layoutMode === 'autoGrid');
  protected readonly imageAssets = computed(() =>
    [...this.store.assets().values()].filter((asset) => asset.kind === 'image'),
  );
  protected readonly backgroundMissing = computed(() => {
    const assetId = this.scene().background.assetId;
    return assetId !== null && !this.store.assetById(assetId);
  });
  protected readonly deleteHint = computed(() => {
    if (!this.isLiveScene()) {
      return t('regie.properties.scene.deleteHint');
    }
    return this.switcher.studioMode()
      ? t('regie.properties.scene.deleteHintLive')
      : t('regie.properties.scene.deleteHintLiveDirect');
  });
  protected readonly deleting = computed(() =>
    this.commands.busy(`scene:${this.scene().id}:delete`),
  );

  constructor() {
    // The field follows the scene name unless the operator is typing in it.
    effect(() => {
      const name = this.scene().name;
      if (!untracked(this.nameFocused)) {
        this.nameControl.setValue(name, { emitEvent: false });
      }
    });
    // A pending delete confirmation belongs to one scene.
    effect(() => {
      this.scene().id;
      untracked(() => this.confirming.set(false));
    });
    effect(() => {
      if (this.disabled()) {
        this.nameControl.disable({ emitEvent: false });
      } else {
        this.nameControl.enable({ emitEvent: false });
      }
    });
  }

  protected onNameFocus(): void {
    this.nameFocused.set(true);
  }

  protected onNameBlur(): void {
    this.nameFocused.set(false);
    void this.saveName();
  }

  protected onNameKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.target as HTMLInputElement).blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.nameControl.setValue(this.scene().name);
      (event.target as HTMLInputElement).blur();
    }
  }

  protected setColor(event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    const background = this.scene().background;
    if (isHexColor(color) && color.toLowerCase() !== background.color.toLowerCase()) {
      void this.commands.setBackground(this.scene().id, { ...background, color });
    }
  }

  protected setBackgroundImage(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const background = this.scene().background;
    const assetId = value === '' ? null : value;
    if (assetId !== background.assetId) {
      void this.commands.setBackground(this.scene().id, { ...background, assetId });
    }
  }

  protected applyTemplate(templateId: LayoutTemplateId): void {
    this.editor.applyTemplate(templateId);
  }

  protected async deleteScene(): Promise<void> {
    if (await this.commands.remove(this.scene().id)) {
      this.confirming.set(false);
    }
  }

  private async saveName(): Promise<void> {
    const name = this.nameControl.value.trim();
    const scene = this.scene();
    if (this.nameControl.invalid || !name) {
      // An empty name is not saved; the field shows the current name again.
      this.nameControl.setValue(scene.name);
      return;
    }
    if (name === scene.name) {
      return;
    }
    if (!(await this.commands.rename(scene.id, name))) {
      this.nameControl.setValue(this.scene().name);
    }
  }
}
