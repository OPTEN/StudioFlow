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
import { StationFocusService } from '../station-focus.service';
import { StatusLineComponent } from './status-line.component';

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

  function segments(): string[] {
    return Array.from(element.querySelectorAll('.c-status__inc')).map((segment) =>
      (segment.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  afterEach(() => harness?.http.verify());

  it('shows «Keine offenen Meldungen» and the last four log entries', async () => {
    await setup(
      snapshotFixture({
        recentLog: ['e', 'd', 'c', 'b', 'a'].map((text) => logFixture(`Ereignis ${text}`)),
      }),
    );
    expect(element.querySelector('.c-status__ok')?.textContent?.trim()).toBe(
      'Keine offenen Meldungen',
    );
    expect(element.querySelector('.c-status__label')?.textContent?.trim()).toBe(
      'Letzte Ereignisse',
    );
    const entries = Array.from(element.querySelectorAll('.c-status__entry')).map((entry) =>
      entry.textContent?.trim(),
    );
    expect(entries).toHaveLength(4);
    expect(entries[0]).toContain('Ereignis e');
    expect(entries[0]).toMatch(/^\d\d:\d\d/);
  });

  it('lists incidents sorted with state word, place, timer and actions', async () => {
    const now = Date.now();
    await setup(
      snapshotFixture({
        sources: [
          sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', {
            label: 'Handy Bühne links',
            status: 'reconnecting',
          }),
          sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', {
            label: 'Laptop Lea · Folien',
            status: 'ended',
          }),
          sourceFixture('dev_cccccccccccccccc', 'camera', 'K2', { label: 'Handy Totale' }),
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
      }),
    );
    expect(element.querySelector('.c-status__ok')).toBeNull();
    const [first, second, third] = segments();
    expect(first).toContain('S1Laptop Lea · Folien');
    expect(first).toContain('Teilen beendet');
    expect(first).toContain('nicht live');
    expect(first).toMatch(/00:0[34]/);
    expect(first).toContain('Neu teilen lassen');
    expect(second).toContain('K1Handy Bühne links');
    expect(second).toContain('verbindet neu');
    expect(second).toContain('im Program');
    expect(second).not.toContain('Neu teilen lassen');
    expect(third).toContain('wieder da');
    expect(third).toContain('war 9 s weg');
    expect(third).toContain('Gesehen');
    const classes = Array.from(element.querySelectorAll('.c-status__inc')).map(
      (segment) => segment.className,
    );
    expect(classes[0]).toContain('is-bad');
    expect(classes[1]).toContain('is-warn');
    expect(classes[2]).toContain('is-ok');
  });

  it('asks for a reshare and acknowledges recovered incidents', async () => {
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

  it('points at the station of an incident', async () => {
    await setup(
      snapshotFixture({
        incidents: [incidentFixture('inc_1', 'dev_aaaaaaaaaaaaaaaa/camera', 'K1')],
      }),
    );
    element.querySelector<HTMLButtonElement>('.c-status__target')?.click();
    expect(TestBed.inject(StationFocusService).request()).toMatchObject({
      deviceId: 'dev_aaaaaaaaaaaaaaaa',
      sourceId: 'dev_aaaaaaaaaaaaaaaa/camera',
    });
  });

  it('shows a calm banner while the server connection is lost', async () => {
    await setup();
    expect(element.querySelector('.c-status__net')).toBeNull();
    hub.drop();
    await render();
    const banner = element.querySelector('.c-status__net');
    expect(banner?.className).toContain('is-warn');
    expect(banner?.textContent).toContain('Keine Verbindung zum Server, die Regie verbindet neu');
    hub.connect();
    await render();
    expect(element.querySelector('.c-status__net')).toBeNull();
  });
});
