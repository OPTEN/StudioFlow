import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { t } from '@studioflow/i18n';
import type { OutputLinkDto } from '@studioflow/scene-model';
import { DownloadService } from '../../core/ui/download.service';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import {
  OBS_FPS,
  obsCanvasSize,
  obsSceneCollection,
  obsSceneCollectionFileName,
} from './obs-scene-collection';

/**
 * "Use as camera …" (issue #9): the short instructions to show a link as the camera "OBS Virtual Camera" in Teams, Zoom
 * or Webex, and the download of a ready-made OBS scene collection for it. The file is built here from the link the
 * Regie already holds.
 */
@Component({
  selector: 'sf-output-camera',
  imports: [IconComponent],
  template: `
    <section
      class="c-output-camera"
      [attr.aria-label]="t('regie.output.camera.title', { name: link().name })"
    >
      <div class="c-pop-h">{{ t('regie.output.camera.title', { name: link().name }) }}</div>
      <p class="c-pop-note">{{ t('regie.output.camera.intro') }}</p>
      <ol class="c-output-camera__steps">
        <li>{{ t('regie.output.camera.step1') }}</li>
        <li>{{ t('regie.output.camera.step2', { name: collectionName() }) }}</li>
        <li>{{ t('regie.output.camera.step3', stepThree()) }}</li>
        <li>{{ t('regie.output.camera.step4') }}</li>
        <li>{{ t('regie.output.camera.step5') }}</li>
      </ol>
      <p class="c-pop-note">{{ t('regie.output.camera.separateMachine') }}</p>
      <p class="c-pop-note">{{ t('regie.output.camera.audio') }}</p>
      <p class="c-pop-note">{{ t('regie.output.camera.runbook') }}</p>
      <div class="c-output-camera__row">
        <button class="c-btn c-btn--sm c-btn--fill" type="button" (click)="download()">
          <svg sfIcon="download" [size]="14"></svg>{{ t('regie.output.camera.download') }}
        </button>
        <button class="c-btn c-btn--sm" type="button" (click)="closed.emit()">
          {{ t('regie.output.camera.close') }}
        </button>
      </div>
    </section>
  `,
  styleUrl: './output-camera.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputCameraComponent {
  private readonly downloads = inject(DownloadService);
  private readonly toasts = inject(ToastService);

  readonly link = input.required<OutputLinkDto>();
  readonly closed = output();

  protected readonly t = t;
  /** The name OBS lists the imported collection under. */
  protected readonly collectionName = computed(() => `StudioFlow – ${this.link().name}`);
  protected readonly stepThree = computed(() => ({ ...obsCanvasSize(), fps: OBS_FPS }));

  protected download(): void {
    const link = this.link();
    const file = obsSceneCollectionFileName(link.name);
    this.downloads.saveText(file, obsSceneCollection(link.name, link.url));
    this.toasts.show(t('regie.output.camera.downloaded', { file }));
  }
}
