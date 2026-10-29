import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { OutputLinkDto, OutputSettingsDto, OutputStatusDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { DownloadService } from '../../core/ui/download.service';
import { ToastService } from '../../core/ui/toast.service';
import { outputLinkUrl } from '../../shell/header/output-url';
import { OutputLinksPageComponent } from './output-links-page.component';

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
  return { links, maxLinks, frameAncestors: ["'self'", 'https://intranet.example'] };
}

function status(states: Record<string, 'connected' | 'stale' | 'none'>): OutputStatusDto {
  const links = Object.entries(states).map(([linkId, state]) => ({
    linkId,
    name: linkId,
    state,
    consumers: state === 'none' ? 0 : 1,
    addresses: [],
    latencyMs: null,
    fps: null,
    lastReportAt: null,
  }));
  return {
    state: links.some((entry) => entry.state === 'connected') ? 'connected' : 'none',
    consumers: links.reduce((sum, entry) => sum + entry.consumers, 0),
    addresses: [],
    latencyMs: null,
    fps: null,
    lastReportAt: null,
    links,
  };
}

describe('outputLinkUrl', () => {
  it('keeps the link as it is without options and appends the chosen flags', () => {
    const url = 'https://a.b/o/x?k=123';
    expect(outputLinkUrl(url, { transparent: false, sound: true, language: 'auto' })).toBe(url);
    expect(outputLinkUrl(url, { transparent: true, sound: false, language: 'de-CH' })).toBe(
      'https://a.b/o/x?k=123&bg=transparent&audio=off&lang=de-CH',
    );
  });
});

describe('OutputLinksPageComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<OutputLinksPageComponent>;
  let element: HTMLElement;

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function open(
    links: OutputLinkDto[] = [PROXY, TEAMS],
    outputStatus: OutputStatusDto = status({ olk_proxy: 'connected', olk_teams: 'none' }),
    maxLinks = 10,
  ): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshotFixture({ outputStatus }));
    fixture = TestBed.createComponent(OutputLinksPageComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
    harness.http.expectOne(BASE).flush(settings(links, maxLinks));
    await render();
  }

  function text(node: Element | null | undefined = element): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function button(label: string | RegExp, scope: Element = element): HTMLButtonElement {
    const found = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((entry) =>
      typeof label === 'string' ? text(entry) === label : label.test(text(entry)),
    );
    if (!found) {
      throw new Error(`no button ${String(label)}`);
    }
    return found;
  }

  async function click(label: string | RegExp, scope?: Element): Promise<void> {
    button(label, scope).click();
    await render();
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function rows(): string[] {
    return Array.from(element.querySelectorAll('.c-links__row')).map((row) => text(row));
  }

  function detail(name: string): HTMLElement {
    const found = element.querySelector<HTMLElement>(`[aria-label="Link “${name}”"]`);
    if (!found) {
      throw new Error(`no open link "${name}"`);
    }
    return found;
  }

  afterEach(() => harness?.http.verify());

  describe('list', () => {
    it('lists every link with its lamp, state and when it was last seen, the first one open', async () => {
      await open();
      expect(rows()[0]).toBe('Proxy connected · 1 page');
      expect(rows()[1]).toContain('Teams camera not connected · last seen');
      expect(element.querySelectorAll('.c-links__row .c-lamp')[1]?.classList.contains('is-idle')).toBe(
        true,
      );
      const first = element.querySelectorAll('.c-links__row')[0]!;
      expect(first.getAttribute('aria-expanded')).toBe('true');
      expect(detail('Proxy')).toBeTruthy();
      expect(element.querySelectorAll('sf-output-link')).toHaveLength(1);
    });

    it('opens and closes a link below its row', async () => {
      await open();
      const second = element.querySelectorAll<HTMLButtonElement>('.c-links__row')[1]!;
      second.click();
      await render();
      expect(second.getAttribute('aria-expanded')).toBe('true');
      expect(detail('Teams camera')).toBeTruthy();
      expect(element.querySelector(`#${second.getAttribute('aria-controls')}`)).not.toBeNull();
      second.click();
      await render();
      expect(element.querySelector('[aria-label="Link “Teams camera”"]')).toBeNull();
    });

    it('teaches what to do when there is no link', async () => {
      await open([], status({}));
      expect(text()).toContain('No output link yet');
      expect(text()).toContain('Add a link below');
    });

    it('shows the websites that may embed the output, read only, with the way to change them', async () => {
      await open();
      const origins = Array.from(element.querySelectorAll('.c-links__origins li')).map((li) =>
        text(li),
      );
      expect(origins).toEqual(['This server', 'https://intranet.example']);
      expect(element.querySelector('a[href="/settings/embedding"]')).not.toBeNull();
    });

    it('offers a retry when the links cannot be loaded', async () => {
      const hub = new FakeStudioHub();
      TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
      harness = await startStore(hub, snapshotFixture());
      fixture = TestBed.createComponent(OutputLinksPageComponent);
      element = fixture.nativeElement as HTMLElement;
      await render();
      harness.http.expectOne(BASE).flush({ code: 'internal_error' }, { status: 500, statusText: 'x' });
      await render();
      await click('Try again');
      harness.http.expectOne(BASE).flush(settings([PROXY]));
      await render();
      expect(rows()).toHaveLength(1);
    });

    it('loads the links again when a link changes its state, so "last seen" stays current', async () => {
      await open();
      harness.emitEvent({
        type: 'outputStatusChanged',
        status: status({ olk_proxy: 'none', olk_teams: 'none' }),
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
      expect(rows()[0]).toContain('Proxy not connected · last seen');
    });
  });

  describe('add link', () => {
    function nameInput(): HTMLInputElement {
      return element.querySelector<HTMLInputElement>('#output-link-name')!;
    }

    it('creates a named link and opens it', async () => {
      await open();
      type(nameInput(), '  Zoom room ');
      await click('Add link');
      const request = harness.http.expectOne(BASE + '/links');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ name: 'Zoom room' });
      request.flush(link('olk_zoom', 'Zoom room', 'z'.repeat(43)), {
        status: 201,
        statusText: 'Created',
      });
      await render();
      expect(rows()).toHaveLength(3);
      expect(detail('Zoom room')).toBeTruthy();
      expect(TestBed.inject(ToastService).current()?.message).toBe('Link “Zoom room” created');
      expect(nameInput().value).toBe('');
    });

    it.each([
      ['', 'Please enter a name of 1 to 40 characters.'],
      ['   ', 'Please enter a name of 1 to 40 characters.'],
      ['x'.repeat(41), 'Please enter a name of 1 to 40 characters.'],
      ['PROXY', 'A link with this name exists already.'],
      ['teams CAMERA', 'A link with this name exists already.'],
    ])('refuses the name "%s" without asking the server', async (name, message) => {
      await open();
      type(nameInput(), name);
      await click('Add link');
      expect(text()).toContain(message);
      harness.http.expectNone(BASE + '/links');
    });

    it('blocks adding at the limit and says why', async () => {
      await open([PROXY, TEAMS], undefined, 2);
      expect(button('Add link').disabled).toBe(true);
      expect(text()).toContain('At most 2 links. Revoke one to add another.');
    });

    it('shows the failure when the server refuses', async () => {
      await open();
      type(nameInput(), 'Extra');
      await click('Add link');
      harness.http
        .expectOne(BASE + '/links')
        .flush({ code: 'limit_reached', status: 409 }, { status: 409, statusText: 'Conflict' });
      await render();
      expect(TestBed.inject(ToastService).current()?.message).toBe('The limit has been reached.');
      expect(rows()).toHaveLength(2);
    });
  });

  describe('a link', () => {
    it('renames the link in place and keeps the list in order', async () => {
      await open();
      await click('Rename', detail('Proxy'));
      type(detail('Proxy').querySelector<HTMLInputElement>('[data-name-input]')!, 'Main proxy');
      await click('Save name', detail('Proxy'));
      const request = harness.http.expectOne(`${BASE}/links/olk_proxy`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ name: 'Main proxy' });
      request.flush({ ...PROXY, name: 'Main proxy' });
      await render();
      expect(rows()[0]).toContain('Main proxy');
      expect(text(detail('Main proxy').querySelector('.c-output-link__name'))).toBe('Main proxy');
    });

    it('does not ask the server when the name did not change', async () => {
      await open();
      await click('Rename', detail('Proxy'));
      await click('Save name', detail('Proxy'));
      harness.http.expectNone(`${BASE}/links/olk_proxy`);
      expect(detail('Proxy').querySelector('[data-name-input]')).toBeNull();
    });

    it('masks the link, shows it on request and copies it with the chosen options', async () => {
      await open();
      const url = (): string => text(detail('Proxy').querySelector('.c-output-link__url'));
      expect(url()).toBe('studioflow.example/o/webinar?k=••••••');
      expect(text()).not.toContain(PROXY_KEY);
      const eye = detail('Proxy').querySelector<HTMLButtonElement>('button[aria-label="Show link"]')!;
      eye.click();
      await render();
      expect(url()).toBe(PROXY.url);
      expect(eye.getAttribute('aria-pressed')).toBe('true');

      await click(/Link options/, detail('Proxy'));
      const switches = detail('Proxy').querySelectorAll<HTMLInputElement>('input[role="switch"]');
      switches[0]!.click();
      switches[1]!.click();
      await render();
      const copy = vi.spyOn(TestBed.inject(ClipboardService), 'copy').mockResolvedValue(true);
      await click('Copy', detail('Proxy'));
      expect(copy).toHaveBeenCalledWith(`${PROXY.url}&bg=transparent&audio=off`, {
        label: 'studioflow.example/o/webinar?k=••••••&bg=transparent&audio=off',
      });
    });

    it('edits the IP restriction as a draft and saves it with "Save access"', async () => {
      await open();
      const scope = detail('Proxy');
      const input = (): HTMLInputElement =>
        scope.querySelector<HTMLInputElement>('.c-output-link__add input')!;
      expect(text(scope)).toContain('Any address may open the output.');
      expect(button('Save access', scope).disabled).toBe(true);

      type(input(), '10.0.0.0/8');
      await click('Add', scope);
      type(input(), 'nope');
      await click('Add', scope);
      expect(text(scope)).toContain('Please enter an IP address like 10.0.0.42');
      expect(text(scope)).toContain('Only these addresses may open the output.');
      expect(text(scope.querySelector('.c-form-actions__state'))).toBe('Unsaved changes');

      await click('Save access', scope);
      const request = harness.http.expectOne(`${BASE}/links/olk_proxy/access`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ allowedIps: ['10.0.0.0/8'] });
      request.flush({ ...PROXY, allowedIps: ['10.0.0.0/8'] });
      await render();
      expect(text(scope.querySelector('.c-output-link__address'))).toBe('10.0.0.0/8');
      expect(button('Save access', scope).disabled).toBe(true);
      expect(TestBed.inject(ToastService).current()?.message).toBe('Access saved');
    });

    it('discards the draft and removes an address only in the draft', async () => {
      await open([{ ...PROXY, allowedIps: ['10.0.0.1'] }, TEAMS]);
      const scope = detail('Proxy');
      scope.querySelector<HTMLButtonElement>('button[aria-label="Remove 10.0.0.1"]')!.click();
      await render();
      expect(scope.querySelectorAll('.c-output-link__ip')).toHaveLength(0);
      await click('Discard changes', scope);
      expect(scope.querySelectorAll('.c-output-link__ip')).toHaveLength(1);
      harness.http.expectNone(`${BASE}/links/olk_proxy/access`);
    });

    it('makes a new link only after the confirmation, which names the consequence', async () => {
      await open();
      const scope = detail('Proxy');
      await click('New link…', scope);
      harness.http.expectNone(`${BASE}/links/olk_proxy/regenerate-key`);
      const confirm = scope.querySelector('[role="group"][aria-label="New link"]');
      expect(text(confirm)).toContain('The old link of “Proxy” stops working at once');
      await click('Make new link', scope);
      const renewed = link('olk_proxy', 'Proxy', 'renewed-key-' + 'c'.repeat(31));
      harness.http.expectOne(`${BASE}/links/olk_proxy/regenerate-key`).flush(renewed);
      await render();
      expect(TestBed.inject(ToastService).current()?.message).toContain(
        'New link for “Proxy” created',
      );
      expect(rows()).toHaveLength(2);
    });

    it('does nothing when the confirmation is cancelled', async () => {
      await open();
      const scope = detail('Proxy');
      await click('Revoke…', scope);
      await click('Cancel', scope);
      expect(scope.querySelector('.c-confirm')).toBeNull();
      expect(rows()).toHaveLength(2);
    });

    it('revokes the link after the confirmation', async () => {
      await open();
      element.querySelectorAll<HTMLButtonElement>('.c-links__row')[1]!.click();
      await render();
      const scope = detail('Teams camera');
      await click('Revoke…', scope);
      expect(text(scope)).toContain('“Teams camera” stops working at once and is removed');
      await click('Revoke', scope);
      const request = harness.http.expectOne(`${BASE}/links/olk_teams`);
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });
      await render();
      expect(rows()).toEqual(['Proxy connected · 1 page']);
    });

    it('keeps the link and shows the error when revoking fails', async () => {
      await open();
      const scope = detail('Proxy');
      await click('Revoke…', scope);
      await click('Revoke', scope);
      harness.http
        .expectOne(`${BASE}/links/olk_proxy`)
        .flush({ code: 'not_found', status: 404 }, { status: 404, statusText: 'Not Found' });
      await render();
      expect(rows()).toHaveLength(2);
      expect(TestBed.inject(ToastService).current()).not.toBeNull();
    });
  });

  describe('use as camera in OBS', () => {
    it('shows the numbered steps with the canvas size and the frame rate', async () => {
      await open();
      const scope = detail('Proxy');
      const toggle = button('Show steps', scope);
      toggle.click();
      await render();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      const steps = Array.from(scope.querySelectorAll('.c-output-camera__steps > li')).map((li) =>
        text(li),
      );
      expect(steps).toHaveLength(5);
      expect(steps[1]).toContain('“StudioFlow – Proxy”');
      expect(steps[2]).toContain('1920 × 1080');
      expect(steps[2]).toContain('30');
      expect(steps[4]).toContain('OBS Virtual Camera');
      expect(text(scope)).toContain('separate computer, not on the Regie laptop');
      expect(text(scope)).toContain('The sound stays on the mixing desk');
      await click('Hide steps', scope);
      expect(scope.querySelector('sf-output-camera')).toBeNull();
    });

    it('downloads the OBS scene collection of the link', async () => {
      await open();
      const saved: { file: string; text: string }[] = [];
      vi.spyOn(TestBed.inject(DownloadService), 'saveText').mockImplementation((file, content) => {
        saved.push({ file, text: content });
      });
      element.querySelectorAll<HTMLButtonElement>('.c-links__row')[1]!.click();
      await render();
      const scope = detail('Teams camera');
      await click('Show steps', scope);
      await click('Download OBS scene collection', scope);
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
  });
});
