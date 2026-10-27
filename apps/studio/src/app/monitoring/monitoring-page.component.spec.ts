import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HUB } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import { snapshotFixture } from '../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../testing/store-harness';
import { MonitoringPageComponent } from './monitoring-page.component';
import { networkLabel } from '../docks/stations/station-view';

describe('MonitoringPageComponent', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let fixture: ComponentFixture<MonitoringPageComponent>;
  let element: HTMLElement;

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function names(): string[] {
    return Array.from(element.querySelectorAll('tbody .c-mon-table__name')).map(text);
  }

  beforeEach(async () => {
    hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshotFixture());
    fixture = TestBed.createComponent(MonitoringPageComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  });

  afterEach(() => harness.http.verify());

  it('shows every station with live telemetry from the store', async () => {
    expect(text(element.querySelector('.c-mon__conn'))).toBe('Live');
    expect(text(element.querySelector('.c-mon__summary'))).toBe(
      '2 stations · 2 sending · no incidents',
    );
    expect(names()).toEqual(['Phone stage left', 'Laptop Lea']);
    hub.emit(HUB.telemetry, {
      deviceId: 'dev_bbbbbbbbbbbbbbbb',
      telemetry: {
        at: new Date().toISOString(),
        rtc: 'connected',
        batteryPct: null,
        charging: null,
        network: 'ethernet',
        rttMs: 12,
        slots: [
          {
            slot: 'screen-1',
            state: 'live',
            width: 2560,
            height: 1440,
            fps: 15,
            bitrateKbps: 1900,
            packetLossPct: 0.2,
            codec: 'vp9',
          },
        ],
      },
    });
    await render();
    const laptop = element.querySelectorAll('tbody tr')[1];
    const cells = Array.from(laptop.querySelectorAll('td')).map(text);
    expect(cells).toEqual([
      'sending',
      'S1live',
      '2560 × 1440',
      '15',
      '1.9',
      'VP9',
      '0.2%',
      '12 ms',
      '–',
      networkLabel('ethernet'),
      'not run',
      '0 s ago',
    ]);
  });

  it('shows how a slot is encoded and flags a sender at its CPU limit', async () => {
    hub.emit(HUB.telemetry, {
      deviceId: 'dev_bbbbbbbbbbbbbbbb',
      telemetry: {
        at: new Date().toISOString(),
        rtc: 'connected',
        batteryPct: null,
        charging: null,
        network: 'ethernet',
        rttMs: 12,
        slots: [
          {
            slot: 'screen-1',
            state: 'live',
            width: 2560,
            height: 1440,
            fps: 9,
            bitrateKbps: 900,
            packetLossPct: 0,
            codec: 'vp9',
            hardwareEncoder: false,
            qualityLimitation: 'cpu',
          },
        ],
      },
    });
    await render();
    const laptop = element.querySelectorAll('tbody tr')[1];
    const encoding = Array.from(laptop.querySelectorAll('td'))[5];
    expect(text(encoding)).toBe('VP9 · software encoding CPU at limit');
    const tag = encoding.querySelector('.c-tag--warn');
    expect(text(tag)).toBe('CPU at limit');
    expect(tag?.getAttribute('title')).toContain('cannot encode fast enough');
    const phone = element.querySelectorAll('tbody tr')[0];
    expect(phone.querySelector('.c-tag--warn')).toBeNull();
  });

  it('sorts by a column header and marks it with aria-sort', async () => {
    const station = Array.from(element.querySelectorAll<HTMLButtonElement>('thead button')).find(
      (button) => text(button) === 'Station',
    ) as HTMLButtonElement;
    station.click();
    await render();
    expect(station.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    expect(names()).toEqual(['Laptop Lea', 'Phone stage left']);
    station.click();
    await render();
    expect(station.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(names()).toEqual(['Phone stage left', 'Laptop Lea']);
    station.click();
    await render();
    expect(station.closest('th')?.hasAttribute('aria-sort')).toBe(false);
  });

  it('reports a lost server connection calmly', async () => {
    hub.drop();
    await render();
    expect(text(element.querySelector('.c-mon__conn'))).toMatch(/^Offline · as of \d\d:\d\d:\d\d$/);
    expect(element.querySelector('.c-mon__conn .c-lamp')?.className).toContain('is-warn');
  });
});
