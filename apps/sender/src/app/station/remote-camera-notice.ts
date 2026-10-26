import { formatNumber, t } from '@studioflow/i18n';
import type { CameraControlDto, CameraStateDto } from '@studioflow/scene-model';

/**
 * What the unobtrusive note on the phone says after a remote camera command (issue #11): the person at the device sees
 * that the control room changed the camera, e.g. “The control room zoomed: 2.0×”.
 */
export type RemoteCameraNotice =
  | { readonly kind: 'zoom'; readonly zoom: number }
  | { readonly kind: 'lens' | 'reset' | 'adjusted' | 'refused' };

/** The note for an applied command, from the state the camera reports afterwards (the actual zoom, a refusal). */
export function remoteCameraNotice(
  command: CameraControlDto,
  state: CameraStateDto | null,
): RemoteCameraNotice {
  if (state?.problem != null) {
    return { kind: 'refused' };
  }
  if (command.reset === true) {
    return { kind: 'reset' };
  }
  if (command.lensId != null) {
    return { kind: 'lens' };
  }
  const zoom = state?.settings.zoom;
  return command.zoom != null && typeof zoom === 'number'
    ? { kind: 'zoom', zoom }
    : { kind: 'adjusted' };
}

/** The text of a note in the active language. */
export function remoteCameraNoticeText(notice: RemoteCameraNotice): string {
  switch (notice.kind) {
    case 'zoom':
      return t('sender.station.remote.zoom', {
        zoom: formatNumber(notice.zoom, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      });
    case 'lens':
      return t('sender.station.remote.lens');
    case 'reset':
      return t('sender.station.remote.reset');
    case 'adjusted':
      return t('sender.station.remote.adjusted');
    case 'refused':
      return t('sender.station.remote.refused');
  }
}
