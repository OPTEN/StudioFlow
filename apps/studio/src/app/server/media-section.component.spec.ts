import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { MediaTestResult } from '@studioflow/media-client';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import {
  appliedStatusFixture,
  configuredSettingsFixture,
  serverSettingsFixture,
} from '../../testing/settings-fixtures';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { MediaTestService } from '../core/media/media-test.service';
import { ProductionStoreService } from '../core/state/production-store.service';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { MediaSectionComponent } from './media-section.component';

describe('MediaSectionComponent', () => {
  let fixture: ComponentFixture<MediaSectionComponent>;
  let http: HttpTestingController;
  let element: HTMLElement;
  const mediaTest = {
    isOpen: false,
    run: vi.fn<(address: string) => Promise<MediaTestResult>>(),
    end: vi.fn<() => Promise<void>>(),
    markSaved: vi.fn<() => void>(),
  };

  async function setup(
    saved = serverSettingsFixture(),
    suggestions: { fromHost: string | null; interfaces: string[] } = {
      fromHost: null,
      interfaces: [],
    },
    broadcast: 'idle' | 'live' = 'idle',
  ): Promise<void> {
    mediaTest.run.mockReset();
    mediaTest.end.mockReset().mockResolvedValue(undefined);
    mediaTest.markSaved.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
        { provide: MediaTestService, useValue: mediaTest },
        { provide: ProductionStoreService, useValue: { broadcast: signal(broadcast) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const loading = TestBed.inject(ServerSettingsService).load();
    http.expectOne('/api/settings').flush(saved);
    await loading;
    fixture = TestBed.createComponent(MediaSectionComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
    http.expectOne('/api/settings/media/suggestions').flush(suggestions);
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function field(): HTMLInputElement {
    return element.querySelector<HTMLInputElement>('#media-address')!;
  }

  function type(value: string): void {
    field().value = value;
    field().dispatchEvent(new Event('input'));
  }

  /** "Test connection" in the group of the test, and the submit button at the end of the form. */
  function buttons(): [HTMLButtonElement, HTMLButtonElement] {
    return [
      element.querySelector<HTMLButtonElement>(
        'section[aria-labelledby="media-test-heading"] button',
      )!,
      element.querySelector<HTMLButtonElement>('.c-srv__actions button[type="submit"]')!,
    ];
  }

  function suggestionButtons(): HTMLButtonElement[] {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('.c-suggest button'));
  }

  async function submit(): Promise<void> {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  }

  function errorText(): string {
    return element.querySelector('#media-address-error')?.textContent?.trim() ?? '';
  }

  afterEach(() => http.verify());

  it('explains the address, labels the field and hints at where to find it', async () => {
    await setup();
    expect(element.querySelector('label')?.textContent).toContain('IPv4 address of this server');
    expect(element.querySelector('#media-address-hint')?.textContent).toContain('hostname -I');
    expect(field().getAttribute('aria-describedby')).toContain('media-address-hint');
    expect(buttons().map((button) => button.textContent?.trim())).toEqual([
      'Test connection',
      'Save',
    ]);
    expect(element.querySelector('#media-test-note')?.textContent).toContain(
      'Restarts the media server',
    );
    expect(buttons()[0].getAttribute('aria-describedby')).toBe('media-test-note');
  });

  it('cannot test or save while the broadcast is on air, and says why', async () => {
    await setup(
      configuredSettingsFixture({ media: { address: '192.168.1.50' } }),
      undefined,
      'live',
    );
    expect(buttons().map((button) => button.disabled)).toEqual([true, true]);
    // One hint, next to the save button; the test button points at it too.
    expect(element.querySelector('#media-live-note')).toBeNull();
    expect(buttons()[0].getAttribute('aria-describedby')).toBe('media-test-note media-save-note');
    expect(element.querySelector('#media-save-note')?.textContent).toContain(
      'Not possible while the broadcast is on air. End the broadcast first.',
    );
    expect(element.textContent?.split('Not possible while the broadcast is on air').length).toBe(2);
  });

  it('shows the saved address', async () => {
    await setup(configuredSettingsFixture({ media: { address: '192.168.1.50' } }));
    expect(field().value).toBe('192.168.1.50');
  });

  it('takes the address the page was opened with when there is none yet, and offers the interfaces', async () => {
    await setup(serverSettingsFixture(), { fromHost: '192.168.1.50', interfaces: ['10.0.0.7'] });
    expect(field().value).toBe('192.168.1.50');
    expect(suggestionButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Use 192.168.1.50 (Address of this page)',
      'Use 10.0.0.7 (Network of the server)',
    ]);
    expect(suggestionButtons().map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
    ]);
    suggestionButtons()[1].click();
    await render();
    expect(field().value).toBe('10.0.0.7');
    expect(suggestionButtons()[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the saved address when the page was opened with another one', async () => {
    await setup(configuredSettingsFixture({ media: { address: '192.168.1.60' } }), {
      fromHost: '192.168.1.50',
      interfaces: [],
    });
    expect(field().value).toBe('192.168.1.60');
  });

  it('asks for the address before it saves or tests', async () => {
    await setup();
    await submit();
    expect(errorText()).toBe('Enter the IPv4 address.');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field());
    buttons()[0].click();
    await render();
    expect(mediaTest.run).not.toHaveBeenCalled();
    http.expectNone('/api/settings/media');
  });

  it.each(['localhost', '192.168.1', '300.1.1.1', '224.0.0.1'])('refuses %s', async (value) => {
    await setup();
    type(value);
    await submit();
    expect(errorText()).toContain('four numbers from 0 to 255');
    http.expectNone('/api/settings/media');
  });

  describe('the test', () => {
    it('shows the round trip when it worked', async () => {
      await setup();
      mediaTest.run.mockResolvedValue({ ok: true, roundTripMs: 18 });
      type('192.168.1.50');
      buttons()[0].click();
      await render();
      expect(mediaTest.run).toHaveBeenCalledWith('192.168.1.50');
      const result = element.querySelector('.c-srv__result')!;
      expect(result.textContent).toContain('192.168.1.50 (round trip 18 ms)');
      expect(result.querySelector('.c-lamp.is-bad')).toBeNull();
    });

    it('says what to check for each place the test can stop', async () => {
      await setup();
      type('192.168.1.50');
      const cases: [MediaTestResult, string][] = [
        [{ ok: false, stage: 'signal', detail: '' }, 'does not answer through the web server'],
        [{ ok: false, stage: 'transport', detail: '' }, 'could not be established'],
        [{ ok: false, stage: 'data', detail: '' }, 'did not come back'],
      ];
      for (const [outcome, text] of cases) {
        mediaTest.run.mockResolvedValue(outcome);
        buttons()[0].click();
        await render();
        const result = element.querySelector('.c-srv__result')!;
        expect(result.textContent).toContain(text);
        expect(result.querySelector('.c-lamp.is-bad')).not.toBeNull();
      }
    });

    it('is shown as running and cannot be started twice', async () => {
      await setup();
      let finish!: (result: MediaTestResult) => void;
      mediaTest.run.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      type('192.168.1.50');
      buttons()[0].click();
      await render();
      expect(buttons()[0].disabled).toBe(true);
      expect(buttons()[0].textContent?.trim()).toBe('Testing…');
      expect(buttons()[1].disabled).toBe(true);
      finish({ ok: true, roundTripMs: 1 });
      await render();
      expect(buttons()[0].disabled).toBe(false);
    });

    it('forgets the result when the address is edited', async () => {
      await setup();
      mediaTest.run.mockResolvedValue({ ok: true, roundTripMs: 18 });
      type('192.168.1.50');
      buttons()[0].click();
      await render();
      type('192.168.1.51');
      await render();
      expect(element.querySelector('.c-srv__result')).toBeNull();
    });

    it('says so when a broadcast is live and the address cannot be tested', async () => {
      await setup();
      const { ApiError } = await import('../core/api/api-error');
      mediaTest.run.mockRejectedValue(new ApiError({ status: 409, code: 'broadcast_live' }));
      type('192.168.1.50');
      buttons()[0].click();
      await render();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('broadcast');
    });

    it('ends an open test when the section goes away', async () => {
      await setup();
      fixture.destroy();
      expect(mediaTest.end).toHaveBeenCalled();
    });
  });

  describe('saving', () => {
    async function flushSave(status = appliedStatusFixture()): Promise<void> {
      const request = http.expectOne('/api/settings/media');
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ address: '192.168.1.50' });
      request.flush(configuredSettingsFixture());
      await flushMicrotasks();
      http.expectOne('/api/settings/status').flush(status);
      await render();
    }

    it('saves the address, waits for LiveKit and reports it', async () => {
      await setup();
      const saved = vi.fn();
      fixture.componentInstance.saved.subscribe(saved);
      type(' 192.168.1.50 ');
      await submit();
      expect(buttons()[1].textContent?.trim()).toBe('Saving…');
      await flushSave();
      expect(mediaTest.markSaved).toHaveBeenCalled();
      expect(saved).toHaveBeenCalledOnce();
    });

    it('names the step in the wizard', async () => {
      await setup();
      fixture.componentRef.setInput('mode', 'next');
      await render();
      expect(buttons()[1].textContent?.trim()).toBe('Save and continue');
    });

    it('reports a LiveKit that did not restart, and does not go on', async () => {
      await setup();
      const saved = vi.fn();
      fixture.componentInstance.saved.subscribe(saved);
      type('192.168.1.50');
      await submit();
      await flushSave(appliedStatusFixture({ liveKit: { applied: false, error: 'exit 1' } }));
      expect(saved).not.toHaveBeenCalled();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain(
        'docker compose logs livekit',
      );
    });

    it('shows what the server found wrong with the address', async () => {
      await setup();
      type('192.168.1.50');
      await submit();
      http
        .expectOne('/api/settings/media')
        .flush(
          { code: 'validation_failed', errors: { address: ['media_address_invalid'] } },
          { status: 400, statusText: 'Bad Request' },
        );
      await render();
      expect(errorText()).toContain('four numbers from 0 to 255');
      expect(field().getAttribute('aria-invalid')).toBe('true');
    });

    it('says so when a live broadcast refuses the change', async () => {
      await setup();
      type('192.168.1.50');
      await submit();
      http
        .expectOne('/api/settings/media')
        .flush({ code: 'broadcast_live' }, { status: 409, statusText: 'Conflict' });
      await render();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('broadcast');
    });
  });
});
