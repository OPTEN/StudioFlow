import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { injectI18n } from '@studioflow/i18n/angular';
import type {
  CameraCapabilitiesDto,
  CameraSettingsDto,
  CameraStateDto,
  DeviceDto,
} from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, deviceFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { dockSnapshot } from '../testing/dock-fixtures';
import { CAMERA_COMMAND_INTERVAL_MS, CameraControlService } from './camera-control.service';
import { CameraPanelComponent, DRAFT_HOLD_MS } from './camera-panel.component';

const PHONE = 'dev_aaaaaaaaaaaaaaaa';
const COMMANDS = `/api/productions/${PRODUCTION_ID}/devices/${PHONE}/commands`;

const ANDROID: CameraCapabilitiesDto = {
  lenses: [
    { id: 'main', label: 'camera2 0, facing back', kind: 'standard' },
    { id: 'wide', label: 'camera2 2, facing back', kind: 'ultraWide' },
  ],
  zoom: { min: 1, max: 8, step: 0.1 },
  focusModes: ['auto', 'manual'],
  focusDistance: { min: 0.1, max: 2, step: 0.05 },
  exposureCompensation: { min: -2, max: 2, step: 0.5 },
  torch: true,
};

const IPHONE: CameraCapabilitiesDto = {
  lenses: [
    { id: 'back', label: 'Back Camera', kind: 'standard' },
    { id: 'front', label: 'Front Camera', kind: 'front' },
  ],
  zoom: null,
  focusModes: [],
  focusDistance: null,
  exposureCompensation: null,
  torch: false,
};

function phone(
  capabilities: CameraCapabilitiesDto,
  settings: Partial<CameraSettingsDto> = {},
  problem: string | null = null,
  overrides: Partial<DeviceDto> = {},
): DeviceDto {
  const camera: CameraStateDto = {
    v: 1,
    capabilities,
    settings: {
      lensId: capabilities.lenses[0].id,
      zoom: 1,
      focusMode: 'auto',
      focusDistance: null,
      exposureCompensation: 0,
      torch: false,
      ...settings,
    },
    problem,
  };
  return deviceFixture(PHONE, 'Phone stage left', {
    telemetry: {
      at: '2026-10-26T08:00:00.000Z',
      rtc: 'connected',
      batteryPct: 80,
      charging: false,
      network: 'wifi',
      rttMs: 20,
      slots: [],
      camera,
    },
    ...overrides,
  });
}

describe('CameraPanelComponent', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let fixture: ComponentFixture<CameraPanelComponent>;
  let element: HTMLElement;
  let i18n: ReturnType<typeof injectI18n>;

  async function setup(device: DeviceDto, inProgram = false): Promise<void> {
    hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    // The language store first: the texts of the panel depend on its locale signal.
    i18n = TestBed.runInInjectionContext(() => injectI18n());
    harness = await startStore(hub, dockSnapshot());
    fixture = TestBed.createComponent(CameraPanelComponent);
    fixture.componentRef.setInput('device', device);
    fixture.componentRef.setInput('inProgram', inProgram);
    fixture.componentRef.setInput('label', 'K1');
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function show(device: DeviceDto): Promise<void> {
    fixture.componentRef.setInput('device', device);
    await render();
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function slider(id: 'zoom' | 'distance' | 'brightness'): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(
      `[data-testid="camera-${id}"]`,
    ) as HTMLInputElement;
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (entry) => text(entry) === label,
    );
  }

  function drag(input: HTMLInputElement, value: number): void {
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
  }

  /** Lets the throttle timer of the service fire. */
  async function tick(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await render();
  }

  function sent(): unknown {
    return harness.http.expectOne(COMMANDS).request.body;
  }

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));

  afterEach(() => {
    harness.http.verify();
    vi.useRealTimers();
  });

  it('offers only the controls the phone reports, each with an accessible name', async () => {
    await setup(phone(ANDROID, { zoom: 2.5, exposureCompensation: 0.5 }));

    expect(element.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Camera controls of Phone stage left',
    );
    expect(slider('zoom').min).toBe('1');
    expect(slider('zoom').max).toBe('8');
    expect(slider('zoom').step).toBe('0.1');
    expect(slider('zoom').labels?.[0].textContent).toContain('Zoom');
    expect(slider('brightness').labels?.[0].textContent).toContain('Brightness');
    expect(button('Standard')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Wide-angle')?.getAttribute('aria-pressed')).toBe('false');
    expect(button('Auto')).toBeDefined();
    expect(button('Lock')).toBeDefined();
    expect(button('On')).toBeDefined();
    expect(button('Reset to auto')).toBeDefined();
    expect(slider('distance')).toBeNull();
  });

  it('shows the values the phone reports, not the requested ones', async () => {
    await setup(phone(ANDROID, { zoom: 2.5, exposureCompensation: 0.5 }));

    expect(slider('zoom').value).toBe('2.5');
    expect(text(element.querySelector('output'))).toBe('2.5×');
    expect(slider('zoom').getAttribute('aria-valuetext')).toBe('2.5×');
    expect(slider('brightness').getAttribute('aria-valuetext')).toBe('+0.5 EV');

    drag(slider('zoom'), 4);
    await tick();
    expect(text(element.querySelector('output'))).toBe('4.0×');
    sent();

    // The phone could only do 3.0×: once the drag is over the slider shows that, not the 4.0× that was asked for.
    await show(phone(ANDROID, { zoom: 3 }));
    await tick(DRAFT_HOLD_MS);
    expect(slider('zoom').value).toBe('3');
    expect(text(element.querySelector('output'))).toBe('3.0×');
  });

  it('shows no sliders for an iPhone that only reports its lenses', async () => {
    await setup(phone(IPHONE));

    expect(element.querySelectorAll('input[type="range"]')).toHaveLength(0);
    expect(button('Lock')).toBeUndefined();
    expect(button('Reset to auto')).toBeDefined();
    expect(button('Standard')).toBeDefined();
    expect(button('Front')).toBeDefined();
  });

  it('says so when the camera has no control at all, when the phone is offline and before its first report', async () => {
    await setup(phone({ ...IPHONE, lenses: [{ id: 'only', label: 'Camera', kind: 'other' }] }));
    expect(text(element.querySelector('[data-testid="camera-status"]'))).toBe(
      'Not available on this device.',
    );

    await show(phone(ANDROID, {}, null, { connection: 'offline' }));
    expect(text(element.querySelector('[data-testid="camera-status"]'))).toBe(
      'The phone is offline. Changes are not sent.',
    );

    await show(deviceFixture(PHONE, 'Phone stage left'));
    expect(text(element.querySelector('[data-testid="camera-status"]'))).toBe(
      'The phone has not reported its camera yet.',
    );
  });

  it('sends a drag as one command at once and then only the newest value (about ten a second at most)', async () => {
    await setup(phone(ANDROID));

    drag(slider('zoom'), 2);
    await tick();
    expect(sent()).toEqual({
      kind: 'cameraControl',
      slot: 'camera',
      text: null,
      camera: {
        v: 1,
        lensId: null,
        zoom: 2,
        focusMode: null,
        focusDistance: null,
        exposureCompensation: null,
        torch: null,
        reset: null,
      },
    });
  });

  it('merges the moves that happen while a command is on its way, and the newest value wins', async () => {
    await setup(phone(ANDROID));
    drag(slider('zoom'), 2);
    await tick();
    const first = harness.http.expectOne(COMMANDS);

    drag(slider('zoom'), 3);
    drag(slider('zoom'), 4);
    drag(slider('brightness'), 1);
    await tick(CAMERA_COMMAND_INTERVAL_MS * 3);
    harness.http.expectNone(COMMANDS);
    first.flush({}, { status: 202, statusText: 'Accepted' });
    await tick(CAMERA_COMMAND_INTERVAL_MS);

    const second = harness.http.expectOne(COMMANDS);
    expect(second.request.body).toMatchObject({ camera: { zoom: 4, exposureCompensation: 1 } });
    second.flush({}, { status: 202, statusText: 'Accepted' });
    await tick(CAMERA_COMMAND_INTERVAL_MS * 3);
    harness.http.expectNone(COMMANDS);
  });

  it('switches the lens at once when the source is not on air', async () => {
    await setup(phone(ANDROID), false);

    button('Wide-angle')?.click();
    await tick();

    expect(element.querySelector('.c-confirm')).toBeNull();
    expect(sent()).toMatchObject({ camera: { lensId: 'wide' } });
  });

  it('asks before it switches the lens of a source that is in the program, with the dashed red box', async () => {
    await setup(phone(ANDROID), true);

    button('Wide-angle')?.click();
    await tick();
    harness.http.expectNone(COMMANDS);
    expect(text(element.querySelector('.c-confirm span'))).toBe(
      'K1 is live. The picture freezes briefly while the phone switches the lens.',
    );

    button('Cancel')?.click();
    await tick();
    harness.http.expectNone(COMMANDS);
    expect(element.querySelector('.c-confirm')).toBeNull();

    button('Wide-angle')?.click();
    await tick();
    button('Switch lens')?.click();
    await tick();
    expect(sent()).toMatchObject({ camera: { lensId: 'wide' } });
    expect(element.querySelector('.c-confirm')).toBeNull();
  });

  it('does not ask for zoom, focus, brightness or light in the program (no interruption)', async () => {
    await setup(phone(ANDROID), true);

    drag(slider('zoom'), 2);
    await tick();

    expect(element.querySelector('.c-confirm')).toBeNull();
    expect(sent()).toMatchObject({ camera: { zoom: 2 } });
  });

  it('says that changes show on air while the camera is in the program, and asks before "Reset to auto"', async () => {
    await setup(phone(ANDROID), true);

    expect(text(element.querySelector('.c-cam__live'))).toBe(
      'Live Every change shows on air right away.',
    );
    button('Reset to auto')?.click();
    await render();
    harness.http.expectNone(COMMANDS);
    expect(text(element.querySelector('.c-confirm span'))).toBe(
      'K1 is live. Zoom, focus, brightness and light go back to automatic at once.',
    );
    button('Reset now')?.click();
    await tick();
    expect(sent()).toMatchObject({ camera: { reset: true } });
    expect(element.querySelector('.c-confirm')).toBeNull();
  });

  it('forgets a failure message when the panel closes', async () => {
    await setup(phone(ANDROID));
    hub.drop();
    await render();
    drag(slider('zoom'), 2);
    await tick(CAMERA_COMMAND_INTERVAL_MS);
    const control = TestBed.inject(CameraControlService);
    expect(control.failureOf(PHONE)).not.toBeNull();
    fixture.destroy();
    expect(control.failureOf(PHONE)).toBeNull();
  });

  it('locks and releases the focus, switches the light, sets the brightness back to auto and resets', async () => {
    await setup(phone(ANDROID, { exposureCompensation: 1 }));

    button('Lock')?.click();
    await tick();
    harness.http.expectOne(COMMANDS).flush({}, { status: 202, statusText: 'Accepted' });

    button('On')?.click();
    await tick(CAMERA_COMMAND_INTERVAL_MS);
    const light = harness.http.expectOne(COMMANDS);
    expect(light.request.body).toMatchObject({ camera: { torch: true } });
    light.flush({}, { status: 202, statusText: 'Accepted' });

    element.querySelector<HTMLButtonElement>('[aria-label="Reset the brightness to 0"]')?.click();
    await tick(CAMERA_COMMAND_INTERVAL_MS);
    const brightness = harness.http.expectOne(COMMANDS);
    expect(brightness.request.body).toMatchObject({ camera: { exposureCompensation: 0 } });
    brightness.flush({}, { status: 202, statusText: 'Accepted' });

    button('Reset to auto')?.click();
    await tick(CAMERA_COMMAND_INTERVAL_MS);
    expect(sent()).toMatchObject({ camera: { reset: true } });
  });

  it('shows the focus distance slider only while the focus is locked', async () => {
    await setup(phone(ANDROID, { focusMode: 'manual', focusDistance: 0.5 }));

    expect(button('Lock')?.getAttribute('aria-pressed')).toBe('true');
    expect(slider('distance').value).toBe('0.5');
    expect(slider('distance').getAttribute('aria-valuetext')).toBe('0.50 m');
  });

  it('shows a refusal of the phone as an inline message and never throws', async () => {
    await setup(phone(ANDROID, {}, 'overconstrained'));

    expect(text(element.querySelector('[data-testid="camera-problem"]'))).toBe(
      'The camera does not support this setting.',
    );
    await show(phone(ANDROID));
    expect(element.querySelector('[data-testid="camera-problem"]')).toBeNull();
  });

  it('shows a failed command (server refusal) as an inline message and clears it after the next one works', async () => {
    await setup(phone(ANDROID));

    drag(slider('zoom'), 2);
    await tick();
    harness.http
      .expectOne(COMMANDS)
      .flush({ code: 'validation_failed' }, { status: 400, statusText: 'Bad Request' });
    await tick();
    expect(element.querySelector('[data-testid="camera-problem"]')).not.toBeNull();

    drag(slider('zoom'), 3);
    await tick(CAMERA_COMMAND_INTERVAL_MS);
    harness.http.expectOne(COMMANDS).flush({}, { status: 202, statusText: 'Accepted' });
    await tick();
    expect(element.querySelector('[data-testid="camera-problem"]')).toBeNull();
  });

  it('sends nothing while the Regie is offline and says why', async () => {
    await setup(phone(ANDROID));
    hub.drop();
    await render();

    drag(slider('zoom'), 2);
    await tick(CAMERA_COMMAND_INTERVAL_MS);

    harness.http.expectNone(COMMANDS);
    expect(element.querySelector('[data-testid="camera-problem"]')).not.toBeNull();
  });

  it('follows the language switch', async () => {
    await setup(phone(ANDROID));
    i18n.setSetting('de-CH');
    await render();

    expect(button('Weitwinkel')).toBeDefined();
    expect(button('Fixieren')).toBeDefined();
    expect(button('Auf automatisch zurücksetzen')).toBeDefined();
    expect(element.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Kamerasteuerung von Phone stage left',
    );
  });
});
