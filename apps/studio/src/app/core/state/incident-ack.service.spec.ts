import { TestBed } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, incidentFixture, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { IncidentAckService } from './incident-ack.service';

describe('IncidentAckService', () => {
  let harness: StoreHarness;
  let acks: IncidentAckService;

  const ackUrl = (id: string): string => `/api/productions/${PRODUCTION_ID}/incidents/${id}/ack`;

  beforeEach(async () => {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      snapshotFixture({
        incidents: [
          incidentFixture('inc_open', 'dev_aaaaaaaaaaaaaaaa/camera', 'K1'),
          incidentFixture('inc_back', 'dev_bbbbbbbbbbbbbbbb/screen-1', 'S1', {
            kind: 'ended',
            endedAt: '2026-10-22T10:00:00.000Z',
          }),
        ],
      }),
    );
    acks = TestBed.inject(IncidentAckService);
  });

  afterEach(() => harness.http.verify());

  it('offers "Seen" only for recovered incidents', () => {
    expect(acks.canAcknowledge('inc_back')).toBe(true);
    expect(acks.canAcknowledge('inc_open')).toBe(false);
    expect(acks.canAcknowledge('inc_unknown')).toBe(false);
  });

  it('acknowledges recovered incidents and never sends an open one (the server would answer 409)', async () => {
    const done = acks.acknowledge(PRODUCTION_ID, ['inc_open', 'inc_back']);
    await flushMicrotasks();
    harness.http.expectNone(ackUrl('inc_open'));
    harness.http
      .expectOne(ackUrl('inc_back'))
      .flush(null, { status: 204, statusText: 'No Content' });
    await expect(done).resolves.toBeUndefined();
  });

  it.each([
    [404, 'not_found'],
    [409, 'conflict'],
  ])('treats %s (acknowledged elsewhere / open again) as no error', async (status, code) => {
    const done = acks.acknowledge(PRODUCTION_ID, ['inc_back']);
    await flushMicrotasks();
    harness.http.expectOne(ackUrl('inc_back')).flush({ code }, { status, statusText: 'x' });
    await expect(done).resolves.toBeUndefined();
  });

  it('rejects other failures for a message', async () => {
    const done = acks.acknowledge(PRODUCTION_ID, ['inc_back']);
    await flushMicrotasks();
    harness.http
      .expectOne(ackUrl('inc_back'))
      .flush({ code: 'service_unavailable' }, { status: 503, statusText: 'Service Unavailable' });
    await expect(done).rejects.toMatchObject({ status: 503 });
  });
});
