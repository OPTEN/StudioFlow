/**
 * Fixtures of the dock specs. The shared fixtures (`apps/studio/src/testing/fixtures.ts`) belong to the shell and
 * stage specs; the dock specs assert the names they show, so they build their snapshot here with fixed English names
 * and do not depend on the wording of the shared fixtures. Test-only.
 */
import type { ProductionSnapshot } from '@studioflow/scene-model';
import { snapshotFixture } from '../../../testing/fixtures';

/** Names of the default scenes (`scn_a`, `scn_b`, `scn_c`) and sources of {@link dockSnapshot}. */
export const DOCK_NAMES = {
  scenes: { scn_a: 'Welcome', scn_b: 'Presentation', scn_c: 'Break' } as Record<string, string>,
  phone: 'Phone stage left',
  phoneDeviceId: 'dev_aaaaaaaaaaaaaaaa',
  laptop: 'Laptop Lea',
  laptopDeviceId: 'dev_bbbbbbbbbbbbbbbb',
  laptopScreen: 'Laptop Lea · Slides',
} as const;

/** `snapshotFixture` with the fixed English names of {@link DOCK_NAMES}; a field in `overrides` replaces the list. */
export function dockSnapshot(overrides: Partial<ProductionSnapshot> = {}): ProductionSnapshot {
  const snapshot = snapshotFixture(overrides);
  return {
    ...snapshot,
    scenes: overrides.scenes
      ? snapshot.scenes
      : snapshot.scenes.map((scene) => ({
          ...scene,
          name: DOCK_NAMES.scenes[scene.id] ?? scene.name,
        })),
    sources: overrides.sources
      ? snapshot.sources
      : snapshot.sources.map((source) => ({
          ...source,
          label:
            source.deviceId === DOCK_NAMES.phoneDeviceId
              ? DOCK_NAMES.phone
              : source.deviceId === DOCK_NAMES.laptopDeviceId
                ? DOCK_NAMES.laptopScreen
                : source.label,
        })),
    devices: overrides.devices
      ? snapshot.devices
      : snapshot.devices.map((device) => ({
          ...device,
          name:
            device.id === DOCK_NAMES.phoneDeviceId
              ? DOCK_NAMES.phone
              : device.id === DOCK_NAMES.laptopDeviceId
                ? DOCK_NAMES.laptop
                : device.name,
        })),
  };
}
