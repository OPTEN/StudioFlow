import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { OutputLinkDto, OutputSettingsDto, OutputStatusDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { PopoverService } from '../../core/ui/popover.directive';
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
  ): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshotFixture({ outputStatus }));
    fixture = TestBed.createComponent(OutputPopoverComponent);
    element = fixture.nativeElement as HTMLElement;
    TestBed.inject(PopoverService).open(OUTPUT_POPOVER);
    await render();
    harness.http.expectOne(BASE).flush(settings(links));
    await render();
  }

  function text(node: Element | null = element): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function value(label: string): HTMLElement | null {
    const term = Array.from(element.querySelectorAll('dt')).find(
      (entry) => entry.textContent?.trim() === label,
    );
    return (term?.nextElementSibling as HTMLElement | null | undefined) ?? null;
  }

  function lines(): string[] {
    return Array.from(element.querySelectorAll('.c-output-pop__line')).map((line) => text(line));
  }

  afterEach(() => harness?.http.verify());

  describe('status', () => {
    it('says the state, where the output is connected from, the format and the latency', async () => {
      await open();
      expect(text(value('State'))).toBe('connected, 1 consumer');
      expect(value('State')?.classList.contains('c-state--ok')).toBe(true);
      expect(text(value('Connected from'))).toBe('10.0.0.42');
      expect(text(value('Format'))).toBe('1920 × 1080 · 16:9 · 30 fps');
      expect(text(value('Latency'))).toBe('not measured yet');
    });

    it('says not connected with a dash for the addresses', async () => {
      await open([PROXY], status({ olk_proxy: 'none' }, { olk_proxy: 'Proxy' }));
      expect(text(value('State'))).toBe('not connected');
      expect(text(value('Connected from'))).toBe('–');
    });

    function loaded(
      droppedFramesPct: number | null,
      decodedStreams: number | null,
      softwareDecodedStreams: number | null,
    ): OutputStatusDto {
      const base = status({ olk_proxy: 'connected' }, { olk_proxy: 'Proxy' });
      return {
        ...base,
        links: base.links.map((entry) => ({ ...entry, droppedFramesPct })),
        decodedStreams,
        softwareDecodedStreams,
      };
    }

    it('says how many streams the page decodes and warns about software decoding', async () => {
      await open([PROXY], loaded(3, 3, 1));
      expect(text(value('Decoding'))).toBe('3 streams · 1 in software');
      expect(value('Decoding')?.classList.contains('c-state--warn')).toBe(true);
      expect(text(value('Dropped frames'))).toBe('3%');
      expect(value('Dropped frames')?.classList.contains('c-state--warn')).toBe(false);
      expect(element.querySelector('.c-output-pop__hint')).toBeNull();
    });

    it('warns about dropped frames from 5 % and says what to do in words', async () => {
      await open([PROXY], loaded(8, 2, 0));
      expect(text(value('Decoding'))).toBe('2 streams');
      expect(value('Dropped frames')?.classList.contains('c-state--warn')).toBe(true);
      expect(text(element.querySelector('.c-output-pop__hint'))).toContain(
        '8% of the frames are dropped',
      );
    });

    it('shows nothing about the load before the page reports it', async () => {
      await open([PROXY], loaded(null, null, null));
      expect(value('Decoding')).toBeNull();
      expect(value('Dropped frames')).toBeNull();
    });

    it('explains blocked sound in words and marks the link', async () => {
      const base = status({ olk_proxy: 'connected' }, { olk_proxy: 'Proxy' });
      await open([PROXY], {
        ...base,
        links: base.links.map((entry) => ({
          ...entry,
          audio: { state: 'blocked', levelDb: null },
        })) as OutputStatusDto['links'],
      });
      expect(text(element.querySelector('.c-output-pop__hint'))).toContain(
        'Click the output page once',
      );
      expect(lines()).toEqual(['Proxy · connected · Audio blocked']);
    });
  });

  describe('links', () => {
    it('lists every link with its own state, its masked URL and a copy button', async () => {
      await open();
      expect(lines()).toEqual(['Proxy · connected', 'Teams camera · not connected']);
      expect(
        Array.from(element.querySelectorAll('.c-output-pop__url')).map((url) => text(url)),
      ).toEqual(['studioflow.example/o/webinar?k=••••••', 'studioflow.example/o/webinar?k=••••••']);
      expect(text()).not.toContain(PROXY_KEY);
      expect(text()).not.toContain(TEAMS_KEY);
      const copies = Array.from(element.querySelectorAll('.c-output-pop__link button')).map(
        (button) => button.getAttribute('aria-label'),
      );
      expect(copies).toEqual(['Copy link “Proxy”', 'Copy link “Teams camera”']);
      expect(element.querySelectorAll('.c-output-pop__link')[1]?.getAttribute('title')).toContain(
        'last seen',
      );
    });

    it('copies the full URL of a link and shows it masked in the toast', async () => {
      await open();
      const copy = vi.spyOn(TestBed.inject(ClipboardService), 'copy').mockResolvedValue(true);
      element.querySelectorAll<HTMLButtonElement>('.c-output-pop__link button')[1]?.click();
      expect(copy).toHaveBeenCalledWith(TEAMS.url, {
        label: 'studioflow.example/o/webinar?k=••••••',
      });
    });

    it('shows and selects the real URL when the clipboard refuses', async () => {
      await open();
      vi.spyOn(TestBed.inject(ClipboardService), 'copy').mockResolvedValue(false);
      const select = vi.spyOn(TestBed.inject(ClipboardService), 'selectContents');
      element.querySelectorAll<HTMLButtonElement>('.c-output-pop__link button')[0]?.click();
      await render();
      expect(text(element.querySelector('[data-url="olk_proxy"]'))).toBe(PROXY.url);
      expect(select).toHaveBeenCalledWith(element.querySelector('[data-url="olk_proxy"]'));
    });

    it('shows a link without a fresh picture as such', async () => {
      await open([PROXY], status({ olk_proxy: 'stale' }, { olk_proxy: 'Proxy' }));
      expect(lines()).toEqual(['Proxy · no current picture']);
      expect(
        element.querySelector('.c-output-pop__link .c-lamp')?.classList.contains('is-warn'),
      ).toBe(true);
    });

    it('says so when there is no link', async () => {
      await open([], status({}, {}));
      expect(text()).toContain('No output link yet.');
      expect(element.querySelector('.c-output-pop__link')).toBeNull();
    });

    it('offers a retry when the links cannot be loaded', async () => {
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
      Array.from(element.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => text(button) === 'Try again')!
        .click();
      harness.http.expectOne(BASE).flush(settings([PROXY]));
      await render();
      expect(lines()).toHaveLength(1);
    });

    it('loads the links again when a link changes its state', async () => {
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
      expect(lines()[0]).toBe('Proxy · not connected');
    });

    it('manages the links on the settings page and closes on the way', async () => {
      await open();
      const manage = element.querySelector<HTMLAnchorElement>('a.c-menu-item')!;
      expect(text(manage)).toBe('Manage output links…');
      expect(manage.getAttribute('href')).toBe('/settings/output');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      manage.click();
      expect(String(navigate.mock.calls[0]?.[0])).toBe('/settings/output');
      expect(TestBed.inject(PopoverService).isOpen(OUTPUT_POPOVER)).toBe(false);
      // Nothing that changes a link is left in the popover.
      for (const gone of ['Add link', 'Rename', 'Revoke', 'New link', 'Use as camera']) {
        expect(text()).not.toContain(gone);
      }
    });
  });
});
