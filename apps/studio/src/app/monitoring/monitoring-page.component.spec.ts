import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HUB } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import { snapshotFixture } from '../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../testing/store-harness';
import { Router } from '@angular/router';
import { ClipboardService } from '../core/ui/clipboard.service';
import { ContextMenuService } from '../core/ui/context-menu';
import { StationFocusService } from '../shell/station-focus.service';
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

  it('names the units in the column headings, so the cells hold plain figures', () => {
    expect(Array.from(element.querySelectorAll('thead th')).map(text)).toEqual([
      'Device',
      'State',
      'Source',
      'Resolution',
      'Frame rate (fps)',
      'Bit rate (Mbit/s)',
      'Encoding',
      'Packet loss (%)',
      'Round trip (ms)',
      'Battery',
      'Network',
      'Tech check',
      'Last seen',
    ]);
  });

  it('shows every station with live telemetry from the store', async () => {
    expect(text(element.querySelector('.c-mon__conn'))).toBe('Live');
    expect(text(element.querySelector('.c-mon__summary'))).toBe(
      '2 devices · 2 sending · no issues',
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
      '0.2',
      '12',
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
      (button) => text(button) === 'Device',
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

  describe('menu of a device', () => {
    function labels(): string[] {
      return (TestBed.inject(ContextMenuService).current()?.entries ?? []).map((entry) =>
        entry === 'separator' ? '—' : entry.label,
      );
    }

    function run(label: string): void {
      const menus = TestBed.inject(ContextMenuService);
      const item = menus
        .current()
        ?.entries.find((entry) => entry !== 'separator' && entry.label === label);
      if (!item || item === 'separator') {
        throw new Error(`no menu item "${label}"`);
      }
      menus.run(item);
    }

    it('opens on a right click and under the ⋯ button of the row', () => {
      const row = element.querySelectorAll('tbody tr')[0];
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(labels()).toEqual(['Show in control room', 'Copy details']);
      expect(TestBed.inject(ContextMenuService).current()?.label).toBe(
        'Actions for Phone stage left',
      );
      TestBed.inject(ContextMenuService).close();

      const more = row.querySelector<HTMLButtonElement>('.c-mon-table__menu');
      expect(more?.getAttribute('aria-label')).toBe('Actions for Phone stage left');
      more?.click();
      expect(labels()).toEqual(['Show in control room', 'Copy details']);
    });

    it('shows the device in the control room', () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      element
        .querySelectorAll('tbody tr')[1]
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      run('Show in control room');

      expect(TestBed.inject(StationFocusService).request()?.deviceId).toBe('dev_bbbbbbbbbbbbbbbb');
      expect(navigate).toHaveBeenCalledWith('/');
    });

    it('copies the values of the device, one line each', () => {
      const copy = vi.spyOn(TestBed.inject(ClipboardService), 'copy').mockResolvedValue(true);
      element
        .querySelectorAll('tbody tr')[0]
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      run('Copy details');

      const [copied, options] = copy.mock.calls[0];
      expect(options).toEqual({ label: 'Phone stage left' });
      const lines = copied.split('\n');
      expect(lines[0]).toMatch(/^Phone stage left · /);
      expect(lines[1]).toBe('State: sending');
      expect(lines).toContain('Round trip (ms): –');
    });
  });

  it('reports a lost server connection calmly', async () => {
    hub.drop();
    await render();
    expect(text(element.querySelector('.c-mon__conn'))).toMatch(/^Offline · as of \d\d:\d\d:\d\d$/);
    expect(element.querySelector('.c-mon__conn .c-lamp')?.className).toContain('is-warn');
  });
});
