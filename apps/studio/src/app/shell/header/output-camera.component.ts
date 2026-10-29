import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { t } from '@studioflow/i18n';
import type { OutputLinkDto } from '@studioflow/scene-model';
import { ProductionStoreService } from '../../core/state/production-store.service';
import { DownloadService } from '../../core/ui/download.service';
import { IconComponent } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { OBS_FPS, obsSceneCollection, obsSceneCollectionFileName } from './obs-scene-collection';

/**
 * "Use as camera in OBS" (issue #9): the numbered steps to show a link as the camera "OBS Virtual Camera" in Teams, Zoom
 * or Webex, with the download of a ready-made OBS scene collection for it as the first action. The file is built here
 * from the link the Regie already holds.
 */
@Component({
  selector: 'sf-output-camera',
  imports: [IconComponent],
  template: `
    <section
      class="c-output-camera"
      [attr.aria-label]="t('regie.output.camera.title', { name: link().name })"
    >
      <p class="c-output-camera__intro">{{ t('regie.output.camera.intro') }}</p>
      <ol class="c-output-camera__steps">
        <li>{{ t('regie.output.camera.step1') }}</li>
        <li>
          {{ t('regie.output.camera.step2', { name: collectionName() }) }}
          <div class="c-output-camera__action">
            <button class="c-btn c-btn--sm c-btn--primary" type="button" (click)="download()">
              <svg sfIcon="download"></svg>{{ t('regie.output.camera.download') }}
            </button>
          </div>
        </li>
        <li>{{ t('regie.output.camera.step3', stepThree()) }}</li>
        <li>{{ t('regie.output.camera.step4') }}</li>
        <li>{{ t('regie.output.camera.step5') }}</li>
      </ol>
      <ul class="c-output-camera__notes">
        <li>{{ t('regie.output.camera.separateMachine') }}</li>
        <li>{{ t('regie.output.camera.audio') }}</li>
      </ul>
    </section>
  `,
  styleUrl: './output-camera.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputCameraComponent {
  private readonly store = inject(ProductionStoreService);
  private readonly downloads = inject(DownloadService);
  private readonly toasts = inject(ToastService);

  readonly link = input.required<OutputLinkDto>();

  protected readonly t = t;
  /** The name OBS lists the imported collection under. */
  protected readonly collectionName = computed(() => `StudioFlow – ${this.link().name}`);
  protected readonly stepThree = computed(() => ({ ...this.store.canvas(), fps: OBS_FPS }));

  protected download(): void {
    const link = this.link();
    const file = obsSceneCollectionFileName(link.name);
    this.downloads.saveText(file, obsSceneCollection(link.name, link.url, this.store.canvas()));
    this.toasts.show(t('regie.output.camera.downloaded', { file }));
  }
}
