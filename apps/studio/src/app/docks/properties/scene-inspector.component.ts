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
import { LIMITS, type LayoutTemplateId, type SceneDto } from '@flowstudio/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { ConfirmBoxComponent } from '../../core/ui/confirm-box.component';
import { EditorService } from '../../stage/editor.service';
import { SwitcherService } from '../../stage/switcher.service';
import { SceneCommandsService } from '../scenes/scene-commands.service';
import { TemplatePickerComponent } from './template-picker.component';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Scene inspector (prototype `renderInspector` without a selection): name, background colour and optional image,
 * «Vorlage anwenden» with the eight templates (Auto-Grid pressed while active) and «Szene löschen» in its danger zone
 * behind a dashed red confirmation. The live scene cannot be deleted (prototype hint texts). The name is saved on
 * Enter or when the field loses the focus; Escape restores it. Everything is disabled while the scene is live in
 * Studio-Modus or the Regie is offline.
 */
@Component({
  selector: 'fs-scene-inspector',
  imports: [ConfirmBoxComponent, ReactiveFormsModule, TemplatePickerComponent],
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
      return 'Löschen entfernt die Szene mit allen Elementen.';
    }
    return this.switcher.studioMode()
      ? 'Die Live-Szene lässt sich nicht löschen.'
      : 'Die Live-Szene lässt sich nicht löschen. Andere Szenen im Studio-Modus bearbeiten.';
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
    if (HEX_COLOR.test(color) && color.toLowerCase() !== background.color.toLowerCase()) {
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
