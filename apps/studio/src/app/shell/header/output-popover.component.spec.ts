import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { OutputLinkDto, OutputSettingsDto, OutputStatusDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { DownloadService } from '../../core/ui/download.service';
import { PopoverService } from '../../core/ui/popover.directive';
import { ToastService } from '../../core/ui/toast.service';
import { OUTPUT_POPOVER, OutputPopoverComponent } from './output-popover.component';

const BASE = `/api/productions/${PRODUCTION_ID}/output`;
const PROXY_KEY = 'proxy-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TEAMS_KEY = 'teams-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function link(
  id: string,
  name: string,
  key: string,
  overrides: Partial<OutputLinkDto> = {},
): OutputLinkDto {
  return {
    id,
    name,
    url: `https://studioflow.example/o/webinar?k=${key}`,
    keyCreatedAt: '2026-10-22T08:00:00Z',
    lastSeenAt: null,
    allowedIps: [],
    ...overrides,
  };
}

const PROXY = link('olk_proxy', 'Proxy', PROXY_KEY);
const TEAMS = link('olk_teams', 'Teams camera', TEAMS_KEY, { lastSeenAt: '2026-10-25T09:30:00Z' });

function settings(links: OutputLinkDto[], maxLinks = 10): OutputSettingsDto {
  return { links, maxLinks, frameAncestors: ["'self'"] };
}

function status(
  states: Record<string, 'connected' | 'stale' | 'none'>,
  names: Record<string, string>,
): OutputStatusDto {
  const links = Object.entries(states).map(([linkId, state]) => ({
    linkId,
    name: names[linkId] ?? linkId,
    state,
    consumers: state === 'none' ? 0 : 1,
    addresses: state === 'none' ? [] : ['10.0.0.42'],
    latencyMs: null,
    fps: null,
    lastReportAt: null,
  }));
  const connected = links.filter((entry) => entry.state === 'connected').length;
  return {
    state: connected > 0 ? 'connected' : 'none',
    consumers: links.reduce((sum, entry) => sum + entry.consumers, 0),
    addresses: connected > 0 ? ['10.0.0.42'] : [],
    latencyMs: null,
    fps: null,
    lastReportAt: null,
    links,
  };
}

describe('OutputPopoverComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<OutputPopoverComponent>;
  let element: HTMLElement;

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function open(
    links: OutputLinkDto[] = [PROXY, TEAMS],
    outputStatus: OutputStatusDto = status(
      { olk_proxy: 'connected', olk_teams: 'none' },
      { olk_proxy: 'Proxy', olk_teams: 'Teams camera' },
    ),
    maxLinks = 10,
  ): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshotFixture({ outputStatus }));
    fixture = TestBed.createComponent(OutputPopoverComponent);
    element = fixture.nativeElement as HTMLElement;
    TestBed.inject(PopoverService).open(OUTPUT_POPOVER);
    await render();
    harness.http.expectOne(BASE).flush(settings(links, maxLinks));
    await render();
  }

  function text(): string {
    return (element.textContent ?? '').replace(/\s+/g, ' ');
  }

  function button(label: string | RegExp): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((entry) =>
      typeof label === 'string'
        ? entry.textContent?.trim() === label
        : label.test(entry.textContent ?? ''),
    );
    if (!found) {
      throw new Error(`no button ${String(label)}`);
    }
    return found;
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function linkRows(): string[] {
    return Array.from(element.querySelectorAll('.c-output-pop__link')).map((row) =>
      (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  afterEach(() => harness?.http.verify());

  describe('links', () => {
    it('lists every link with its own state and when it was last seen', async () => {
      await open();
      const rows = linkRows();
      expect(rows[0]).toBe('Proxy · connected');
      expect(rows[1]).toContain('Teams camera · not connected');
      expect(rows[1]).toContain('last seen');
      expect(text()).toContain('connected, 1 consumer');
    });

    it('says "never connected" for a link nobody used yet', async () => {
      await open(
        [PROXY, link('olk_new', 'New', 'k'.repeat(43))],
        status({ olk_proxy: 'none', olk_new: 'none' }, {}),
      );
      expect(linkRows()[1]).toContain('never connected');
    });

    it('shows a link without a fresh picture as such', async () => {
      await open([PROXY], status({ olk_proxy: 'stale' }, { olk_proxy: 'Proxy' }));
      expect(linkRows()).toEqual(['Proxy · no current picture']);
      expect(
        element.querySelector('.c-output-pop__link .c-lamp')?.classList.contains('is-warn'),
      ).toBe(true);
    });

    it('selects the first link, masks its URL and switches to another link on click', async () => {
      await open();
      expect(element.querySelector('.c-linkbox__text')?.textContent).toBe(
        'studioflow.example/o/webinar?k=••••••',
      );
      expect(element.querySelector('.c-output-link__name')?.textContent).toBe('Proxy');
      element.querySelectorAll<HTMLButtonElement>('.c-output-pop__link')[1]?.click();
      await render();
      expect(element.querySelector('.c-output-link__name')?.textContent).toBe('Teams camera');
      expect(element.querySelectorAll('.c-output-pop__link')[1]?.getAttribute('aria-current')).toBe(
        'true',
      );
      expect(text()).not.toContain(PROXY_KEY);
      expect(text()).not.toContain(TEAMS_KEY);
    });

    it('says so when there is no link', async () => {
      await open([], status({}, {}));
      expect(text()).toContain('No link yet');
      expect(element.querySelector('sf-output-link')).toBeNull();
    });

    it('offers a retry when the settings cannot be loaded', async () => {
      const hub = new FakeStudioHub();
      TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
      harness = await startStore(hub, snapshotFixture());
      fixture = TestBed.createComponent(OutputPopoverComponent);
      element = fixture.nativeElement as HTMLElement;
      TestBed.inject(PopoverService).open(OUTPUT_POPOVER);
      await render();
      harness.http
        .expectOne(BASE)
        .flush({ code: 'internal_error' }, { status: 500, statusText: 'x' });
      await render();
      button('Try again').click();
      harness.http.expectOne(BASE).flush(settings([PROXY]));
      await render();
      expect(linkRows()).toHaveLength(1);
    });

    it('loads the settings again when a link changes its state, so "last seen" stays current', async () => {
      await open();
      harness.emitEvent({
        type: 'outputStatusChanged',
        status: status(
          { olk_proxy: 'none', olk_teams: 'none' },
          { olk_proxy: 'Proxy', olk_teams: 'Teams camera' },
        ),
      });
      await render();
      harness.http
        .expectOne(BASE)
        .flush(
          settings([
            link('olk_proxy', 'Proxy', PROXY_KEY, { lastSeenAt: '2026-10-26T08:00:00Z' }),
            TEAMS,
          ]),
        );
      await render();
      expect(linkRows()[0]).toContain('Proxy · not connected');
      expect(linkRows()[0]).toContain('last seen');
    });
  });

  describe('add link', () => {
    it('creates a named link and selects it', async () => {
      await open();
      type(element.querySelector<HTMLInputElement>('.c-output-pop__add input')!, '  Zoom room ');
      button('Add link').click();
      const request = harness.http.expectOne(BASE + '/links');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ name: 'Zoom room' });
      request.flush(link('olk_zoom', 'Zoom room', 'z'.repeat(43)), {
        status: 201,
        statusText: 'Created',
      });
      await render();
      expect(linkRows()).toHaveLength(3);
      expect(element.querySelector('.c-output-link__name')?.textContent).toBe('Zoom room');
      expect(TestBed.inject(ToastService).current()?.message).toBe('Link “Zoom room” created');
      expect(element.querySelector<HTMLInputElement>('.c-output-pop__add input')?.value).toBe('');
    });

    it.each([
      ['', 'Please enter a name of 1 to 40 characters.'],
      ['   ', 'Please enter a name of 1 to 40 characters.'],
      ['x'.repeat(41), 'Please enter a name of 1 to 40 characters.'],
      ['PROXY', 'A link with this name exists already.'],
      ['teams CAMERA', 'A link with this name exists already.'],
    ])('refuses the name "%s" without asking the server', async (name, message) => {
      await open();
      type(element.querySelector<HTMLInputElement>('.c-output-pop__add input')!, name);
      button('Add link').click();
      await render();
      expect(text()).toContain(message);
      harness.http.expectNone(BASE + '/links');
    });

    it('blocks adding at the limit and says why', async () => {
      await open([PROXY, TEAMS], undefined, 2);
      expect(button('Add link').disabled).toBe(true);
      expect(text()).toContain('At most 2 links. Revoke one to add another.');
    });

    it('shows the failure when the server refuses (limit reached in the meantime)', async () => {
      await open();
      type(element.querySelector<HTMLInputElement>('.c-output-pop__add input')!, 'Extra');
      button('Add link').click();
      harness.http
        .expectOne(BASE + '/links')
        .flush({ code: 'limit_reached', status: 409 }, { status: 409, statusText: 'Conflict' });
      await render();
      expect(TestBed.inject(ToastService).current()?.message).toBe('The limit has been reached.');
      expect(linkRows()).toHaveLength(2);
    });
  });

  describe('selected link', () => {
    it('renames the link and keeps the list in order', async () => {
      await open();
      button('Rename').click();
      await render();
      type(element.querySelector<HTMLInputElement>('.c-output-link__rename input')!, 'Main proxy');
      button('Save').click();
      const request = harness.http.expectOne(`${BASE}/links/olk_proxy`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ name: 'Main proxy' });
      request.flush({ ...PROXY, name: 'Main proxy' });
      await render();
      expect(element.querySelector('.c-output-link__name')?.textContent).toBe('Main proxy');
      expect(linkRows()[0]).toContain('Main proxy');
    });

    it('does not ask the server when the name did not change', async () => {
      await open();
      button('Rename').click();
      await render();
      button('Save').click();
      await render();
      harness.http.expectNone(`${BASE}/links/olk_proxy`);
      expect(element.querySelector('.c-output-link__rename')).toBeNull();
    });

    it('saves the IP restriction of this link only', async () => {
      await open();
      const input = (): HTMLInputElement =>
        element.querySelector<HTMLInputElement>('.c-output-link__add input')!;
      type(input(), '10.0.0.0/8');
      button('Add').click();
      await render();
      type(input(), 'nope');
      button('Add').click();
      await render();
      expect(text()).toContain('Please enter an IP address like 10.0.0.42');
      button('Save').click();
      const request = harness.http.expectOne(`${BASE}/links/olk_proxy/access`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ allowedIps: ['10.0.0.0/8'] });
      request.flush({ ...PROXY, allowedIps: ['10.0.0.0/8'] });
      await render();
      expect(element.querySelector('.c-output-link__ip .u-mono')?.textContent).toBe('10.0.0.0/8');
    });

    it('drops the unsaved IP list when another link is selected', async () => {
      await open();
      type(element.querySelector<HTMLInputElement>('.c-output-link__add input')!, '10.0.0.1');
      button('Add').click();
      await render();
      expect(element.querySelectorAll('.c-output-link__ip')).toHaveLength(1);
      element.querySelectorAll<HTMLButtonElement>('.c-output-pop__link')[1]?.click();
      await render();
      expect(element.querySelectorAll('.c-output-link__ip')).toHaveLength(0);
    });

    it('regenerates only this link after the confirmation and keeps the others', async () => {
      await open();
      button('Regenerate link').click();
      await render();
      harness.http.expectNone(`${BASE}/links/olk_proxy/regenerate-key`);
      expect(text()).toContain('The old link of “Proxy” stops working immediately.');
      button('Regenerate').click();
      const renewed = link('olk_proxy', 'Proxy', 'renewed-key-' + 'c'.repeat(31));
      harness.http.expectOne(`${BASE}/links/olk_proxy/regenerate-key`).flush(renewed);
      await render();
      expect(TestBed.inject(ToastService).current()?.message).toContain(
        'New link for “Proxy” created',
      );
      expect(linkRows()).toHaveLength(2);
    });

    it('does nothing when the confirmation is cancelled', async () => {
      await open();
      button('Revoke link').click();
      await render();
      button('Cancel').click();
      await render();
      expect(element.querySelector('.c-confirm')).toBeNull();
      expect(linkRows()).toHaveLength(2);
    });

    it('revokes the link after the confirmation and selects the first one that is left', async () => {
      await open();
      element.querySelectorAll<HTMLButtonElement>('.c-output-pop__link')[1]?.click();
      await render();
      button('Revoke link').click();
      await render();
      expect(text()).toContain('Pages that use “Teams camera” are disconnected immediately.');
      button('Revoke').click();
      const request = harness.http.expectOne(`${BASE}/links/olk_teams`);
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });
      await render();
      expect(linkRows()).toEqual(['Proxy · connected']);
      expect(element.querySelector('.c-output-link__name')?.textContent).toBe('Proxy');
    });

    it('keeps the link and shows the error when revoking fails', async () => {
      await open();
      button('Revoke link').click();
      await render();
      button('Revoke').click();
      harness.http
        .expectOne(`${BASE}/links/olk_proxy`)
        .flush({ code: 'not_found', status: 404 }, { status: 404, statusText: 'Not Found' });
      await render();
      expect(linkRows()).toHaveLength(2);
      expect(TestBed.inject(ToastService).current()).not.toBeNull();
    });
  });

  describe('use as camera', () => {
    it('shows the short instructions with the canvas size and the frame rate', async () => {
      await open();
      button('Use as camera …').click();
      await render();
      const steps = Array.from(element.querySelectorAll('.c-output-camera__steps li')).map(
        (li) => li.textContent ?? '',
      );
      expect(steps).toHaveLength(5);
      expect(steps[1]).toContain('“StudioFlow – Proxy”');
      expect(steps[2]).toContain('1920 × 1080');
      expect(steps[2]).toContain('30');
      expect(steps[4]).toContain('OBS Virtual Camera');
      expect(text()).toContain('separate computer, not on the Regie laptop');
      expect(text()).toContain('The sound stays on the mixing desk');
    });

    it('downloads the OBS scene collection of the selected link', async () => {
      await open();
      const saved: { file: string; text: string }[] = [];
      vi.spyOn(TestBed.inject(DownloadService), 'saveText').mockImplementation((file, content) => {
        saved.push({ file, text: content });
      });
      element.querySelectorAll<HTMLButtonElement>('.c-output-pop__link')[1]?.click();
      await render();
      button('Use as camera …').click();
      await render();
      button('Download OBS scene collection').click();
      expect(saved).toHaveLength(1);
      expect(saved[0]?.file).toBe('StudioFlow-Teams-camera.json');
      const collection = JSON.parse(saved[0]!.text) as {
        sources: { settings: Record<string, unknown> }[];
      };
      expect(collection.sources[1]?.settings['url']).toBe(TEAMS.url);
      expect(TestBed.inject(ToastService).current()?.message).toContain(
        'StudioFlow-Teams-camera.json',
      );
    });

    it('closes the instructions again', async () => {
      await open();
      button('Use as camera …').click();
      await render();
      button('Close instructions').click();
      await render();
      expect(element.querySelector('sf-output-camera')).toBeNull();
      expect(button('Use as camera …')).toBeTruthy();
    });
  });
});
