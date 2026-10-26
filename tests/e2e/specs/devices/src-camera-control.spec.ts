import type { Locator } from '@playwright/test';
import { ANDROID_CAMERA, BARE_CAMERA, installCameraStub, readCamera, refuseConstraints } from '../../support/devices/camera-stub';
import { FULL, livePhone, putInScene } from '../../support/devices/fleet';
import { expect, test } from '../../support/ui/fixtures';
import { t } from '../../support/tags';

/**
 * Remote camera control of a phone (issue #11, E2E-SRC-23 ... 27): the Regie panel of a station shows only what the
 * phone reports, a command reaches the camera clamped and the panel shows the value the camera really has, a lens switch
 * of a live source asks first, a refused change is an inline message and the settings come back after a reload.
 * The camera is Chromium's fake device behind support/devices/camera-stub.ts, which answers getCapabilities /
 * getSettings / applyConstraints like the profile says (the fake device itself reports what the build gives it). The
 * texts are looked up by test id, so the checks do not depend on the language of the Regie.
 */

/** The camera panel of a station row, opened. */
async function openPanel(row: Locator): Promise<Locator> {
  await row.locator('.c-st__row').click();
  await row.getByTestId('camera-open').click();
  const panel = row.getByTestId('camera-panel');
  await expect(panel).toBeVisible();
  return panel;
}

/** The value a slider shows next to it (`<output>`). */
const shown = (panel: Locator, slider: 'zoom' | 'brightness' | 'distance') => panel.getByTestId(`camera-${slider}`).locator('xpath=following-sibling::output[1]');

test.describe('SRC camera control', () => {
  test(
    'E2E-SRC-23 [ui, pixel7] a camera that reports no control: the panel says so and offers no slider',
    t.p1,
    async ({ regie, openPhone, pairContext }) => {
      test.setTimeout(120_000);
      const { row } = await livePhone({ openPhone }, pairContext, regie, 'Phone without controls', { init: (context) => installCameraStub(context, BARE_CAMERA) });
      const panel = await openPanel(row);

      await expect(panel.getByTestId('camera-status')).toBeVisible();
      await expect(panel.locator('input[type=range]')).toHaveCount(0);
      await expect(panel.getByTestId('camera-lens')).toHaveCount(0);
      await expect(panel.getByTestId('camera-reset')).toHaveCount(0);
    },
  );

  test(
    'E2E-SRC-24 [ui, pixel7] zoom and brightness: the command reaches the camera, the panel shows the value the camera reports; the API clamps and refuses',
    t.p0,
    async ({ regie, api, production, openPhone, pairContext }) => {
      test.setTimeout(120_000);
      const { phone, device, row } = await livePhone({ openPhone }, pairContext, regie, 'Phone Zoom', { init: (context) => installCameraStub(context, ANDROID_CAMERA) });
      const panel = await openPanel(row);
      await expect(panel.getByTestId('camera-zoom')).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByTestId('camera-zoom')).toHaveAttribute('min', '1');
      await expect(panel.getByTestId('camera-zoom')).toHaveAttribute('max', '8');

      await panel.getByTestId('camera-zoom').fill('3');
      await expect.poll(async () => (await readCamera(phone.page)).zoom, { message: 'the camera zoomed', timeout: 15_000 }).toBeCloseTo(3, 5);
      await expect(shown(panel, 'zoom')).toHaveText(/^3.0×$/, { timeout: 15_000 });
      await expect(phone.page.getByTestId('remote-camera-notice')).not.toBeEmpty();

      await panel.getByTestId('camera-brightness').fill('1');
      await expect.poll(async () => (await readCamera(phone.page)).exposureCompensation, { timeout: 15_000 }).toBeCloseTo(1, 5);
      await expect(shown(panel, 'brightness')).toHaveText(/^\+1.0 EV$/, { timeout: 15_000 });

      // A value beyond the range is clamped by the API to what the phone reported; the camera really has the clamped value.
      const clamped = await api.sendDeviceCommand(production.id, device.id, { kind: 'cameraControl', slot: 'camera', text: null, camera: { v: 1, lensId: null, zoom: 20, focusMode: null, focusDistance: null, exposureCompensation: null, torch: null, reset: null } });
      expect(clamped.status).toBe(202);
      expect(clamped.body.camera?.zoom).toBe(8);
      await expect.poll(async () => (await readCamera(phone.page)).zoom, { timeout: 15_000 }).toBeCloseTo(8, 5);
      await expect(shown(panel, 'zoom')).toHaveText(/^8.0×$/, { timeout: 15_000 });

      // A control the phone does not report, a lens it does not have and a wrong version are refused (400).
      const none = { v: 1, lensId: null, zoom: null, focusMode: null, focusDistance: null, exposureCompensation: null, torch: null, reset: null };
      for (const camera of [{ ...none, lensId: 'someone-elses-camera' }, { ...none, v: 2, zoom: 2 }, { ...none }]) {
        const refused = await api.sendDeviceCommand(production.id, device.id, { kind: 'cameraControl', slot: 'camera', text: null, camera });
        expect(refused.status, JSON.stringify(camera)).toBe(400);
      }
    },
  );

  test(
    'E2E-SRC-25 [ui, pixel7] lens switch: a live source asks first, the picture stays live, zoom starts again at 1',
    t.p0,
    async ({ regie, api, production, openPhone, pairContext }) => {
      test.setTimeout(150_000);
      const { phone, sourceId, row } = await livePhone({ openPhone }, pairContext, regie, 'Phone Lens', { init: (context) => installCameraStub(context, ANDROID_CAMERA) });
      await putInScene(api, production, 0, sourceId, FULL);
      const panel = await openPanel(row);
      const wide = panel.locator('[data-testid=camera-lens][data-lens=cam-wide]');
      await expect(wide).toBeVisible({ timeout: 15_000 });
      await panel.getByTestId('camera-zoom').fill('2');
      await expect.poll(async () => (await readCamera(phone.page)).zoom, { timeout: 15_000 }).toBeCloseTo(2, 5);
      const capturesBefore = (await readCamera(phone.page)).captures;

      // In the program: the dashed red confirmation first, nothing happens before it is confirmed.
      await wide.click();
      await expect(panel.locator('.c-confirm')).toBeVisible();
      expect((await readCamera(phone.page)).deviceId).toBe('cam-back');
      await panel.locator('.c-confirm [data-cancel]').click();
      await expect(panel.locator('.c-confirm')).toHaveCount(0);
      expect((await readCamera(phone.page)).deviceId).toBe('cam-back');

      await wide.click();
      await panel.locator('.c-confirm .c-btn--danger-fill').click();
      await expect.poll(async () => (await readCamera(phone.page)).deviceId, { message: 'the phone switched the lens', timeout: 20_000 }).toBe('cam-wide');
      await expect(wide).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
      expect((await readCamera(phone.page)).captures).toBe(capturesBefore + 1);
      // The source never left the air: the slot is live again, and zoom starts at 1× on the other lens.
      await phone.waitForCamera('live', 20_000);
      await expect(shown(panel, 'zoom')).toHaveText(/^1.0×$/, { timeout: 15_000 });
    },
  );

  test(
    'E2E-SRC-26 [ui, pixel7] a refused change is an inline message and the panel keeps showing the real value; "Reset to auto" sets everything back',
    t.p1,
    async ({ regie, openPhone, pairContext }) => {
      test.setTimeout(120_000);
      const { phone, row } = await livePhone({ openPhone }, pairContext, regie, 'Phone Light', { init: (context) => installCameraStub(context, ANDROID_CAMERA) });
      const panel = await openPanel(row);
      await expect(panel.getByTestId('camera-torch-on')).toBeVisible({ timeout: 15_000 });
      await refuseConstraints(phone.page, ['torch']);

      await panel.getByTestId('camera-torch-on').click();
      await expect(panel.getByTestId('camera-problem')).toBeVisible({ timeout: 15_000 });
      expect((await readCamera(phone.page)).torch).toBe(false);
      await expect(panel.getByTestId('camera-torch-off')).toHaveAttribute('aria-pressed', 'true');
      await expect(phone.page.getByTestId('connection-state').first()).toHaveAttribute('data-state', 'connected');

      // The light works again; the next change clears the message.
      await refuseConstraints(phone.page, []);
      await panel.getByTestId('camera-zoom').fill('4');
      await expect.poll(async () => (await readCamera(phone.page)).zoom, { timeout: 15_000 }).toBeCloseTo(4, 5);
      await expect(panel.getByTestId('camera-problem')).toHaveCount(0, { timeout: 15_000 });

      await panel.getByTestId('camera-focus-lock').click();
      await panel.getByTestId('camera-torch-on').click();
      await expect.poll(async () => (await readCamera(phone.page)).focusMode, { timeout: 15_000 }).toBe('manual');
      await expect.poll(async () => (await readCamera(phone.page)).torch, { timeout: 15_000 }).toBe(true);
      await panel.getByTestId('camera-reset').click();
      await expect.poll(async () => await readCamera(phone.page), { message: 'everything back to automatic', timeout: 15_000 }).toMatchObject({ zoom: 1, focusMode: 'continuous', exposureCompensation: 0, torch: false });
      await expect(panel.getByTestId('camera-focus-auto')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    },
  );

  test(
    'E2E-SRC-27 [ui, pixel7] the settings come back after a reload of the phone: lens, zoom and brightness',
    t.p1,
    async ({ regie, openPhone, pairContext }) => {
      test.setTimeout(150_000);
      const { phone, row } = await livePhone({ openPhone }, pairContext, regie, 'Phone Restart', { init: (context) => installCameraStub(context, ANDROID_CAMERA) });
      const panel = await openPanel(row);
      const wide = panel.locator('[data-testid=camera-lens][data-lens=cam-wide]');
      await expect(wide).toBeVisible({ timeout: 15_000 });
      await wide.click();
      await expect.poll(async () => (await readCamera(phone.page)).deviceId, { timeout: 20_000 }).toBe('cam-wide');
      await panel.getByTestId('camera-zoom').fill('2.5');
      await panel.getByTestId('camera-brightness').fill('-1');
      await expect.poll(async () => await readCamera(phone.page), { timeout: 15_000 }).toMatchObject({ zoom: 2.5, exposureCompensation: -1 });

      await phone.page.reload();
      await phone.waitConnected();
      await expect.poll(async () => await readCamera(phone.page), { message: 'the camera came back as it was', timeout: 30_000 }).toMatchObject({ deviceId: 'cam-wide', zoom: 2.5, exposureCompensation: -1 });
      await expect(shown(panel, 'zoom')).toHaveText(/^2.5×$/, { timeout: 20_000 });
      await expect(wide).toHaveAttribute('aria-pressed', 'true');
    },
  );
});
