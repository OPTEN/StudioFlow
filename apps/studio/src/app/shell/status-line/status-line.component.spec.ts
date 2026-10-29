import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  defaultScenes,
  incidentFixture,
  logFixture,
  snapshotFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { PopoverService } from '../../core/ui/popover.directive';
import { StationFocusService } from '../station-focus.service';
import { ISSUES_POPOVER, StatusLineComponent } from './status-line.component';

describe('StatusLineComponent', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let fixture: ComponentFixture<StatusLineComponent>;
  let element: HTMLElement;

  async function setup(snapshot = snapshotFixture()): Promise<void> {
    hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshot);
    fixture = TestBed.createComponent(StatusLineComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function clean(node: Element | null): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** Every incident of the issues popover (in the DOM while closed, hidden). */
  function rows(): string[] {
    return Array.from(element.querySelectorAll('.c-status__inc')).map(clean);
  }

  function health(): HTMLButtonElement {
    return element.querySelector<HTMLButtonElement>('.c-status__health')!;
  }

  function issues(): HTMLElement {
    return element.querySelector<HTMLElement>('.c-status__issues')!;
  }

  const threeIncidents = () => {
    const now = Date.now();
    return snapshotFixture({
      sources: [
        sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', {
          label: 'Phone stage left',
          status: 'reconnecting',
        }),
        sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', {
          label: 'Laptop Lea · Slides',
          status: 'ended',
        }),
        sourceFixture('dev_cccccccccccccccc', 'camera', 'K2', { label: 'Phone wide' }),
      ],
      scenes: defaultScenes(),
      incidents: [
        incidentFixture('inc_1', 'dev_aaaaaaaaaaaaaaaa/camera', 'K1', {
          kind: 'reconnecting',
          startedAt: new Date(now - 8000).toISOString(),
        }),
        incidentFixture('inc_2', 'dev_cccccccccccccccc/camera', 'K2', {
          kind: 'reconnecting',
          startedAt: new Date(now - 60000).toISOString(),
          endedAt: new Date(now - 51000).toISOString(),
        }),
        incidentFixture('inc_3', 'dev_bbbbbbbbbbbbbbbb/screen-1', 'S1', {
          kind: 'ended',
          startedAt: new Date(now - 3000).toISOString(),
        }),
      ],
    });
  };

  afterEach(() => harness?.http.verify());

  it('is the "Activity" region with the device health, the latest event and the activity log', async () => {
    await setup(
      snapshotFixture({
        recentLog: ['e', 'd', 'c', 'b', 'a'].map((text) => logFixture(`Event ${text}`)),
      }),
    );
    expect(element.getAttribute('aria-label')).toBe('Activity');
    expect(clean(health())).toBe('All 2 devices OK');
    expect(health().querySelector('.c-lamp')?.className).not.toMatch(/is-(idle|warn|bad)/);
    expect(element.querySelector('.c-status__lead')).toBeNull();
    // One line: the latest event only, from its code and parameters, in the language of the Regie.
    const entries = Array.from(element.querySelectorAll('.c-status__entry')).map(clean);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^\d\d:\d\d Scene “Event e” is live$/);
    expect(element.querySelector('a.c-status__audit')?.getAttribute('href')).toBe('/audit');
    expect(clean(element.querySelector('a.c-status__audit'))).toBe('Activity log');
  });

  it('never shows a green lamp without devices', async () => {
    await setup(snapshotFixture({ devices: [], sources: [] }));
    expect(clean(health())).toBe('No devices yet');
    expect(health().querySelector('.c-lamp')?.classList).toContain('is-idle');
  });

  it('shows the most severe incident inline with "+N more" and lists every incident in the issues popover', async () => {
    await setup(threeIncidents());
    expect(clean(health())).toBe('2 issues');
    expect(health().querySelector('.c-lamp')?.classList).toContain('is-bad');

    const lead = element.querySelector('.c-status__lead');
    expect(lead?.classList).toContain('is-bad');
    expect(clean(lead)).toContain('S1 Laptop Lea · Slides');
    expect(clean(lead)).toContain('sharing stopped');
    expect(clean(lead)).toContain('Ask to share again');
    expect(clean(element.querySelector('.c-status__more'))).toBe('+2 more');

    const [first, second, third] = rows();
    expect(first).toContain('S1 Laptop Lea · Slides');
    expect(first).toContain('sharing stopped');
    expect(first).toContain('not live');
    expect(first).toMatch(/00:0[34]/);
    expect(first).toContain('Ask to share again');
    expect(second).toContain('K1 Phone stage left');
    expect(second).toContain('reconnecting');
    expect(second).toContain('on Program');
    expect(second).not.toContain('Ask to share again');
    expect(third).toContain('back');
    expect(third).toContain('was gone for 9 s');
    expect(third).toContain('Dismiss');
    const classes = Array.from(element.querySelectorAll('.c-status__inc')).map(
      (segment) => segment.className,
    );
    expect(classes[0]).toContain('is-bad');
    expect(classes[1]).toContain('is-warn');
    expect(classes[2]).toContain('is-ok');
  });

  it('opens the issues popover from the health button and from "+N more"', async () => {
    await setup(threeIncidents());
    expect(issues().hidden).toBe(true);
    expect(issues().classList).not.toContain('c-pop');
    health().click();
    await render();
    expect(issues().hidden).toBe(false);
    expect(issues().classList).toContain('c-pop');
    expect(health().getAttribute('aria-expanded')).toBe('true');
    expect(issues().querySelector('a[href="/monitoring"]')?.textContent?.trim()).toBe(
      'Open monitoring',
    );
    TestBed.inject(PopoverService).close(ISSUES_POPOVER);
    await render();
    expect(issues().hidden).toBe(true);
    element.querySelector<HTMLButtonElement>('.c-status__more')?.click();
    await render();
    expect(issues().hidden).toBe(false);
  });

  it('asks for a reshare and dismisses recovered incidents', async () => {
    const now = Date.now();
    await setup(
      snapshotFixture({
        incidents: [
          incidentFixture('inc_3', 'dev_bbbbbbbbbbbbbbbb/screen-1', 'S1', { kind: 'ended' }),
          incidentFixture('inc_2', 'dev_aaaaaaaaaaaaaaaa/camera', 'K1', {
            startedAt: new Date(now - 60000).toISOString(),
            endedAt: new Date(now - 51000).toISOString(),
          }),
        ],
      }),
    );
    const buttons = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.c-status__inc .c-btn'),
    );
    buttons[0].click();
    const reshare = harness.http.expectOne(
      `/api/productions/${PRODUCTION_ID}/devices/dev_bbbbbbbbbbbbbbbb/commands`,
    );
    expect(reshare.request.body).toEqual({ kind: 'reshare', slot: 'screen-1', text: null });
    // A second click while the request runs sends nothing.
    await render();
    expect(buttons[0].disabled).toBe(true);
    reshare.flush(
      { id: 'cmd_1', kind: 'reshare', slot: 'screen-1', text: null, at: '' },
      { status: 202, statusText: 'Accepted' },
    );
    buttons[1].click();
    harness.http
      .expectOne(`/api/productions/${PRODUCTION_ID}/incidents/inc_2/ack`)
      .flush(null, { status: 204, statusText: 'No Content' });
    await render();
  });

  it('marks every recovered incident as seen at once', async () => {
    const now = Date.now();
    const recovered = (id: string, device: string, code: string) =>
      incidentFixture(id, `${device}/camera`, code, {
        startedAt: new Date(now - 60000).toISOString(),
        endedAt: new Date(now - 51000).toISOString(),
      });
    await setup(
      snapshotFixture({
        incidents: [
          recovered('inc_1', 'dev_aaaaaaaaaaaaaaaa', 'K1'),
          recovered('inc_2', 'dev_bbbbbbbbbbbbbbbb', 'K2'),
        ],
      }),
    );
    const markAll = Array.from(issues().querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Mark all as seen',
    );
    markAll?.click();
    harness.http
      .expectOne(`/api/productions/${PRODUCTION_ID}/incidents/inc_1/ack`)
      .flush(null, { status: 204, statusText: 'No Content' });
    await flushMicrotasks();
    harness.http
      .expectOne(`/api/productions/${PRODUCTION_ID}/incidents/inc_2/ack`)
      .flush(null, { status: 204, statusText: 'No Content' });
    await render();
  });

  it('names an ended camera "camera stopped" and offers "Ask to share again" only for screens', async () => {
    await setup(
      snapshotFixture({
        incidents: [
          incidentFixture('inc_1', 'dev_aaaaaaaaaaaaaaaa/camera', 'K1', { kind: 'ended' }),
          incidentFixture('inc_2', 'dev_bbbbbbbbbbbbbbbb/screen-1', 'S1', { kind: 'ended' }),
        ],
      }),
    );
    const [camera, screen] = rows();
    expect(camera).toContain('camera stopped');
    expect(camera).not.toContain('Ask to share again');
    expect(screen).toContain('sharing stopped');
    expect(screen).toContain('Ask to share again');
  });

  it('points at the device of an incident and names it in the accessible name', async () => {
    await setup(
      snapshotFixture({
        incidents: [incidentFixture('inc_1', 'dev_aaaaaaaaaaaaaaaa/camera', 'K1')],
      }),
    );
    const target = element.querySelector<HTMLButtonElement>('.c-status__lead .c-status__target')!;
    // The visible text is the name (WCAG 2.5.3); the tooltip says where it leads.
    expect(target.hasAttribute('aria-label')).toBe(false);
    expect(target.getAttribute('title')).toBe('Show in the Devices dock');
    target.click();
    expect(TestBed.inject(StationFocusService).request()).toMatchObject({
      deviceId: 'dev_aaaaaaaaaaaaaaaa',
      sourceId: 'dev_aaaaaaaaaaaaaaaa/camera',
    });
  });

  it('gives the row to a calm banner while the server connection is lost', async () => {
    await setup(
      snapshotFixture({
        incidents: [incidentFixture('inc_1', 'dev_aaaaaaaaaaaaaaaa/camera', 'K1')],
        recentLog: [logFixture('Event a')],
      }),
    );
    expect(element.querySelector('.c-status__net')).toBeNull();
    hub.drop();
    await render();
    const banner = element.querySelector('.c-status__net');
    expect(banner?.className).toContain('is-warn');
    expect(banner?.textContent).toContain(
      'No connection to the server, the control room is reconnecting',
    );
    expect(element.querySelector('.c-status__lead')).toBeNull();
    expect(element.querySelector('.c-status__entry')).toBeNull();
    expect(element.querySelector('.c-status__health')).not.toBeNull();
    hub.connect();
    await render();
    expect(element.querySelector('.c-status__net')).toBeNull();
    expect(element.querySelector('.c-status__lead')).not.toBeNull();
  });
});
