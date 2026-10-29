import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { canvasDto, type OutputStatusDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  incidentFixture,
  productionFixture,
  snapshotFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { KeyboardService } from '../../core/ui/keyboard.service';
import { DockLayoutService } from '../workspace/dock-layout.service';
import { HeaderComponent } from './header.component';
import { maskOutputUrl } from './output-link.component';
import { isIpOrCidr } from './ip-address';

const BASE = `/api/productions/${PRODUCTION_ID}`;

describe('HeaderComponent', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let fixture: ComponentFixture<HeaderComponent>;
  let element: HTMLElement;

  async function setup(snapshot = snapshotFixture()): Promise<void> {
    hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshot);
    fixture = TestBed.createComponent(HeaderComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function text(scope: Element = element): string {
    return (scope.textContent ?? '').replace(/\s+/g, ' ');
  }

  function button(label: string, scope: Element = element): HTMLButtonElement {
    const found = Array.from(scope.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === label,
    );
    if (!found) {
      throw new Error(`no button "${label}"`);
    }
    return found;
  }

  function dialog(name: string): HTMLElement {
    const found = Array.from(element.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
      (entry) =>
        entry.getAttribute('aria-label') === name ||
        element.querySelector(`#${entry.getAttribute('aria-labelledby')}`)?.textContent?.trim() ===
          name,
    );
    if (!found) {
      throw new Error(`no dialog "${name}"`);
    }
    return found;
  }

  function chip(): HTMLButtonElement {
    return element.querySelector<HTMLButtonElement>('.c-header__out')!;
  }

  function output(overrides: Partial<OutputStatusDto> = {}): OutputStatusDto {
    return {
      state: 'connected',
      consumers: 1,
      addresses: ['10.0.0.42'],
      latencyMs: 148,
      fps: 30,
      lastReportAt: null,
      links: [
        {
          linkId: 'olk_proxy',
          name: 'Proxy',
          state: 'connected',
          consumers: 1,
          addresses: ['10.0.0.42'],
          latencyMs: 148,
          fps: 30,
          lastReportAt: null,
        },
      ],
      ...overrides,
    };
  }

  afterEach(() => harness?.http.verify());

  it('shows brand, production, the off-air capsule, output, layout, settings, presence and clock', async () => {
    await setup();
    expect(text()).toContain('StudioFlow');
    expect(text()).toContain('Webinar');
    expect(element.querySelector('.c-live b')?.textContent?.trim()).toBe('Off air');
    expect(button('Start broadcast').disabled).toBe(false);
    expect(element.querySelector('.c-header__out-label')?.textContent).toBe('Output');
    expect(button('Layout').getAttribute('aria-haspopup')).toBe('dialog');
    expect(element.querySelector('.c-header__presence-count')?.textContent?.trim()).toBe('1');
    expect(element.querySelector('.c-header__presence .u-sr-only')?.textContent).toBe(
      'One person in the control room',
    );
    expect(element.querySelector('.c-header__clock')?.textContent).toMatch(/^\d\d:\d\d:\d\d$/);
  });

  it('leads to the settings window with the gear and carries no sponsor link', async () => {
    await setup();
    const settings = element.querySelector<HTMLAnchorElement>('a.c-header__settings');
    expect(settings?.getAttribute('href')).toBe('/settings');
    expect(settings?.getAttribute('aria-label')).toBe('Settings');
    expect(element.querySelector('a[href="https://www.opten.ch"]')).toBeNull();
    expect(element.querySelector('[aria-controls="sf-pop-settings"]')).toBeNull();
  });

  it('asks before the broadcast starts and shows the pre-flight check', async () => {
    await setup();
    button('Start broadcast').click();
    await render();
    harness.http.expectNone(`${BASE}/broadcast/start`);
    const popover = dialog('Start the broadcast?');
    expect(text(popover)).toContain('The output switches from the slate to the program.');
    const checks = Array.from(popover.querySelectorAll('.c-broadcast__check')).map((check) => ({
      text: text(check).trim(),
      warn: check.classList.contains('is-warn'),
    }));
    expect(checks).toEqual([
      {
        text: 'No output connected yet Viewers see nothing until the proxy opens the output.',
        warn: true,
      },
      { text: 'No open issues', warn: false },
      { text: 'Program: Welcome', warn: false },
    ]);
    // Cancel comes first, so the focus lands on it and a second Enter never starts by accident.
    expect(popover.querySelector('button')?.textContent?.trim()).toBe('Cancel');
    button('Start broadcast', popover).click();
    await render();
    harness.http
      .expectOne(`${BASE}/broadcast/start`)
      .flush(productionFixture({ broadcast: 'live' }));
    await render();
  });

  it('names the open issues and the connected output in the pre-flight check', async () => {
    await setup(
      snapshotFixture({
        outputStatus: output(),
        sources: [sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { status: 'reconnecting' })],
        incidents: [incidentFixture('inc_1', 'dev_aaaaaaaaaaaaaaaa/camera', 'K1')],
      }),
    );
    button('Start broadcast').click();
    await render();
    const checks = Array.from(
      dialog('Start the broadcast?').querySelectorAll('.c-broadcast__check'),
    ).map((check) => text(check).trim());
    expect(checks.slice(0, 2)).toEqual(['Output connected', '1 open issue']);
  });

  it('shows "On air" with the runtime and ends the broadcast after confirmation', async () => {
    const liveSince = new Date(Date.now() - (42 * 60 + 13) * 1000).toISOString();
    await setup(
      snapshotFixture({ production: productionFixture({ broadcast: 'live', liveSince }) }),
    );
    expect(element.querySelector('.c-broadcast')?.classList).toContain('is-live');
    expect(element.querySelector('.c-live b')?.textContent?.trim()).toBe('On air');
    expect(element.querySelector('.c-live__time')?.textContent).toMatch(/^00:42:1[34]$/);
    button('End broadcast').click();
    await render();
    const popover = dialog('End the broadcast?');
    expect(text(popover)).toContain('The output then shows “Thanks for watching”.');
    harness.http.expectNone(`${BASE}/broadcast/end`);
    popover.querySelector<HTMLButtonElement>('.c-btn--danger-fill')?.click();
    harness.http
      .expectOne(`${BASE}/broadcast/end`)
      .flush(productionFixture({ broadcast: 'ended' }));
    await render();
  });

  it('offers "Back to standby" and "Start again…" after the end', async () => {
    await setup(snapshotFixture({ production: productionFixture({ broadcast: 'ended' }) }));
    expect(element.querySelector('.c-live b')?.textContent?.trim()).toBe('Ended');
    button('Start again…').click();
    await render();
    expect(dialog('Start the broadcast?')).toBeTruthy();
    button('Cancel').click();
    await render();
    button('Back to standby').click();
    harness.http.expectOne(`${BASE}/broadcast/reset`).flush(productionFixture());
    await render();
  });

  it('disables the broadcast actions while offline and says why', async () => {
    await setup();
    hub.drop();
    await render();
    expect(button('Start broadcast').disabled).toBe(true);
    expect(element.querySelector('.c-broadcast')?.getAttribute('title')).toBe(
      'Not available while the control room has no connection',
    );
  });

  describe('output capsule', () => {
    it('says "Not connected" while no output page is connected, without a tooltip', async () => {
      await setup();
      expect(text(chip())).toContain('Output Not connected');
      expect(chip().querySelector('.c-lamp')?.classList).toContain('is-idle');
      expect(chip().hasAttribute('title')).toBe(false);
    });

    it('shows the latency and opens the output popover with the masked link', async () => {
      await setup(snapshotFixture({ outputStatus: output() }));
      expect(element.querySelector('.c-header__out-state')?.textContent?.trim()).toBe('148 ms');
      chip().click();
      await render();
      harness.http.expectOne(`${BASE}/output`).flush({
        links: [
          {
            id: 'olk_proxy',
            name: 'Proxy',
            url: 'https://studioflow.example.com/o/webinar?k=secret123',
            keyCreatedAt: '2026-10-22T08:00:00Z',
            lastSeenAt: null,
            allowedIps: [],
          },
        ],
        maxLinks: 10,
        frameAncestors: ["'self'"],
      });
      await render();
      expect(text()).toContain('connected, 1 consumer');
      expect(text()).toContain('10.0.0.42');
      expect(text()).toContain('1920 × 1080 · 16:9 · 30 fps');
      expect(text()).toContain('studioflow.example.com/o/webinar?k=••••••');
      expect(text()).not.toContain('secret123');
    });

    it('lists every link with its state in the tooltip', async () => {
      const link = (linkId: string, name: string, state: 'connected' | 'stale' | 'none') => ({
        linkId,
        name,
        state,
        consumers: state === 'none' ? 0 : 1,
        addresses: [],
        latencyMs: null,
        fps: null,
        lastReportAt: null,
      });
      await setup(
        snapshotFixture({
          outputStatus: output({
            consumers: 2,
            latencyMs: null,
            links: [
              link('olk_a', 'Proxy', 'connected'),
              link('olk_b', 'Teams camera', 'connected'),
              link('olk_c', 'Zoom', 'none'),
            ],
          }),
        }),
      );
      expect(element.querySelector('.c-header__out-state')?.textContent?.trim()).toBe('Connected');
      expect(chip().getAttribute('title')).toBe(
        'Proxy · connected\nTeams camera · connected\nZoom · not connected',
      );
    });

    it('says "No picture" in amber while the output page reports no current picture', async () => {
      await setup(snapshotFixture({ outputStatus: output({ state: 'stale' }) }));
      const state = element.querySelector('.c-header__out-state');
      expect(state?.textContent?.trim()).toBe('No picture');
      expect(state?.classList).toContain('c-state--warn');
      expect(chip().querySelector('.c-lamp')?.classList).toContain('is-warn');
    });

    describe('the load of the output page', () => {
      const withDrops = (state: 'connected' | 'stale', droppedFramesPct: number | null) =>
        output({
          state,
          latencyMs: 90,
          links: [
            {
              linkId: 'olk_a',
              name: 'Proxy',
              state,
              consumers: 1,
              addresses: [],
              latencyMs: 90,
              fps: 30,
              lastReportAt: null,
              droppedFramesPct,
            },
          ],
        });

      it('warns "Drops frames" in amber when the computer of the output page cannot keep up', async () => {
        await setup(snapshotFixture({ outputStatus: withDrops('connected', 12) }));
        expect(element.querySelector('.c-header__out-warn')?.textContent?.trim()).toBe(
          'Drops frames',
        );
        expect(chip().querySelector('.c-lamp')?.classList).toContain('is-warn');
        const title = chip().getAttribute('title') ?? '';
        expect(title).toContain('Proxy · connected');
        expect(title).toContain('12% of the frames are dropped');
      });

      it('stays calm for a few dropped frames', async () => {
        await setup(snapshotFixture({ outputStatus: withDrops('connected', 2) }));
        expect(element.querySelector('.c-header__out-warn')).toBeNull();
        expect(chip().querySelector('.c-lamp')?.classList).not.toContain('is-warn');
        expect(chip().getAttribute('title')).toBe('Proxy · connected');
      });

      it('does not blame the computer of a page that is no longer connected', async () => {
        await setup(snapshotFixture({ outputStatus: withDrops('stale', 40) }));
        expect(element.querySelector('.c-header__out-warn')).toBeNull();
      });
    });

    it('shows the canvas of a portrait production in the output popover', async () => {
      await setup(
        snapshotFixture({
          production: productionFixture({ canvas: canvasDto('portrait', 'p720') }),
        }),
      );
      chip().click();
      await render();
      harness.http.expectOne(`${BASE}/output`).flush({
        links: [],
        maxLinks: 10,
        frameAncestors: ["'self'"],
      });
      await render();

      expect(text()).toContain('720 × 1280 · 9:16 · 30 fps');
    });
  });

  describe('layout', () => {
    it('shows a switch per dock and hides a dock with it', async () => {
      await setup();
      button('Layout').click();
      await render();
      const popover = dialog('Layout');
      const switches = Array.from(
        popover.querySelectorAll<HTMLInputElement>('input[role="switch"]'),
      );
      expect(switches.map((entry) => text(entry.closest('label')!).trim())).toEqual([
        'Scenes',
        'Sources',
        'Properties',
        'Devices',
        'Audio',
      ]);
      expect(switches.every((entry) => entry.checked)).toBe(true);
      switches[1].click();
      expect(TestBed.inject(DockLayoutService).isShown('src')).toBe(false);
    });

    it('resets the layout only after a confirmation', async () => {
      await setup();
      const layout = TestBed.inject(DockLayoutService);
      layout.setShown('audio', false);
      button('Layout').click();
      await render();
      button('Reset layout…').click();
      await render();
      const confirm = dialog('Layout').querySelector('[role="group"]');
      expect(text(confirm!)).toContain('Every dock goes back to the bottom');
      expect(layout.isShown('audio')).toBe(false);
      button('Reset layout', confirm!).click();
      await render();
      expect(layout.isShown('audio')).toBe(true);
      expect(button('Reset layout…')).toBeTruthy();
    });

    it('opens the keyboard shortcuts from the layout popover and with the ? key', async () => {
      await setup();
      button('Layout').click();
      await render();
      // The ? keycap next to the label is hidden from the accessible name.
      Array.from(element.querySelectorAll<HTMLButtonElement>('.c-layout-pop button'))
        .find((entry) => entry.textContent?.includes('Keyboard shortcuts'))
        ?.click();
      await render();
      const sheet = element.querySelector<HTMLDialogElement>('dialog.c-sheet')!;
      expect(sheet.open).toBe(true);
      expect(element.querySelector('.c-layout-pop')).toBeNull();
      const keys = Array.from(sheet.querySelectorAll('.c-keys__row')).map((row) =>
        Array.from(row.querySelectorAll('kbd')).map((key) => key.textContent?.trim()),
      );
      expect(keys).toContainEqual(['1–9']);
      expect(keys).toContainEqual(['Space']);
      expect(keys).toContainEqual(['M']);
      expect(keys).toContainEqual(['Esc']);
      expect(keys).toContainEqual(['?']);
      button('', sheet.querySelector('.c-sheet__head')!).click();
      await render();
      expect(sheet.open).toBe(false);

      const keyboard = TestBed.inject(KeyboardService);
      keyboard.handle(new KeyboardEvent('keydown', { key: '?', shiftKey: true, cancelable: true }));
      await render();
      expect(sheet.open).toBe(true);
      keyboard.handle(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      await render();
      expect(sheet.open).toBe(false);
    });
  });

  it('shows who is in the control room in the presence popover', async () => {
    await setup(snapshotFixture({ operatorsOnline: 2 }));
    expect(element.querySelector('.c-header__presence-count')?.textContent?.trim()).toBe('2');
    element.querySelector<HTMLButtonElement>('.c-header__presence')?.click();
    await render();
    expect(text(dialog('2 people in the control room'))).toContain(
      'Changes made by one person appear for everyone in the control room at once.',
    );
  });

  it('masks output links and validates IP entries', () => {
    expect(maskOutputUrl('https://a.b/o/x?k=123&bg=transparent')).toBe(
      'a.b/o/x?k=••••••&bg=transparent',
    );
    expect(isIpOrCidr('10.0.0.42')).toBe(true);
    expect(isIpOrCidr('10.0.0.0/24')).toBe(true);
    expect(isIpOrCidr('fd00::/64')).toBe(true);
    expect(isIpOrCidr('::1')).toBe(true);
    expect(isIpOrCidr('::ffff:10.0.0.1')).toBe(true);
    expect(isIpOrCidr('2001:db8:0:0:0:0:0:1')).toBe(true);
    expect(isIpOrCidr('256.0.0.1')).toBe(false);
    expect(isIpOrCidr('10.0.0.0/33')).toBe(false);
    expect(isIpOrCidr('1:2:3:4:5:6:7::8')).toBe(false);
    expect(isIpOrCidr('proxy.local')).toBe(false);
    expect(isIpOrCidr('')).toBe(false);
  });
});
