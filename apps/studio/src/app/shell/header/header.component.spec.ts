import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  incidentFixture,
  productionFixture,
  snapshotFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { StationFocusService } from '../station-focus.service';
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

  function text(): string {
    return (element.textContent ?? '').replace(/\s+/g, ' ');
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === label,
    );
    if (!found) {
      throw new Error(`no button "${label}"`);
    }
    return found;
  }

  afterEach(() => harness?.http.verify());

  it('shows brand, production, quiet READY, output, health, presence and clock', async () => {
    await setup();
    expect(text()).toContain('StudioFlow');
    expect(text()).toContain('Webinar');
    expect(text()).toContain('READY');
    expect(button('Start broadcast').disabled).toBe(false);
    expect(text()).toContain('Output');
    expect(text()).toContain('All 2 stations ok');
    expect(text()).toContain('1 in the control room');
    expect(element.querySelector('.c-header__clock')?.textContent).toMatch(/^\d\d:\d\d:\d\d$/);
  });

  it('starts the broadcast', async () => {
    await setup();
    button('Start broadcast').click();
    harness.http
      .expectOne(`${BASE}/broadcast/start`)
      .flush(productionFixture({ broadcast: 'live' }));
    await render();
  });

  it('shows LIVE with the runtime and ends the broadcast after confirmation', async () => {
    const liveSince = new Date(Date.now() - (42 * 60 + 13) * 1000).toISOString();
    await setup(
      snapshotFixture({ production: productionFixture({ broadcast: 'live', liveSince }) }),
    );
    expect(text()).toContain('LIVE');
    expect(element.querySelector('.c-live__time')?.textContent).toMatch(/^00:42:1[34]$/);
    button('End broadcast').click();
    await render();
    expect(text()).toContain('The output then shows “Thanks for watching”.');
    harness.http.expectNone(`${BASE}/broadcast/end`);
    const confirm = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.c-btn--danger-fill'),
    )[0];
    confirm.click();
    harness.http
      .expectOne(`${BASE}/broadcast/end`)
      .flush(productionFixture({ broadcast: 'ended' }));
    await render();
  });

  it('offers "Back to Ready" after the end', async () => {
    await setup(snapshotFixture({ production: productionFixture({ broadcast: 'ended' }) }));
    expect(text()).toContain('ENDED');
    button('Back to Ready').click();
    harness.http.expectOne(`${BASE}/broadcast/reset`).flush(productionFixture());
    await render();
  });

  it('summarises outages and jumps to the most severe one', async () => {
    await setup(
      snapshotFixture({
        sources: [
          sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { status: 'reconnecting' }),
          sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', { status: 'ended' }),
        ],
        incidents: [
          incidentFixture('inc_1', 'dev_aaaaaaaaaaaaaaaa/camera', 'K1', {
            startedAt: '2026-10-22T09:00:00Z',
          }),
          incidentFixture('inc_2', 'dev_bbbbbbbbbbbbbbbb/screen-1', 'S1', { kind: 'ended' }),
        ],
      }),
    );
    expect(text()).toContain('2 incidents');
    expect(element.querySelector('.c-chipbtn .c-lamp.is-bad')).not.toBeNull();
    button('2 incidents').click();
    expect(TestBed.inject(StationFocusService).request()?.deviceId).toBe('dev_bbbbbbbbbbbbbbbb');
  });

  it('opens the output popover with the masked link', async () => {
    await setup(
      snapshotFixture({
        outputStatus: {
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
        },
      }),
    );
    expect(text()).toContain('148 ms');
    expect(element.querySelector('.c-header__out-label')?.textContent).toBe('Output');
    expect(element.querySelector('.c-header__out-links')?.textContent).toBe('Proxy');
    element.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"].c-chipbtn')?.click();
    await render();
    harness.http.expectOne(`${BASE}/output`).flush({
      links: [
        {
          id: 'olk_proxy',
          name: 'Proxy',
          url: 'https://studioflow.opten.ch/o/webinar?k=secret123',
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
    expect(text()).toContain('1920 × 1080 · 30 fps');
    expect(text()).toContain('studioflow.opten.ch/o/webinar?k=••••••');
    expect(text()).not.toContain('secret123');
  });

  it('names every connected output link in the chip and lists all links with their state in its tooltip', async () => {
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
        outputStatus: {
          state: 'connected',
          consumers: 2,
          addresses: [],
          latencyMs: null,
          fps: null,
          lastReportAt: null,
          links: [
            link('olk_a', 'Proxy', 'connected'),
            link('olk_b', 'Teams camera', 'connected'),
            link('olk_c', 'Zoom', 'none'),
          ],
        },
      }),
    );
    expect(element.querySelector('.c-header__out-links')?.textContent).toBe('Proxy + Teams camera');
    expect(element.querySelector('.c-chipbtn')?.getAttribute('title')).toBe(
      'Proxy · connected\nTeams camera · connected\nZoom · not connected',
    );
  });

  it('shows no link name in the chip while no output link is connected', async () => {
    await setup();
    expect(element.querySelector('.c-header__out-links')).toBeNull();
    expect(element.querySelector('.c-chipbtn')?.hasAttribute('title')).toBe(false);
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
