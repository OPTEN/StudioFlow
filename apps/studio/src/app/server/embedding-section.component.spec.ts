import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import { appliedStatusFixture, configuredSettingsFixture } from '../../testing/settings-fixtures';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { ServerSettingsService } from '../core/state/server-settings.service';
import { EmbeddingSectionComponent } from './embedding-section.component';

describe('EmbeddingSectionComponent', () => {
  let fixture: ComponentFixture<EmbeddingSectionComponent>;
  let http: HttpTestingController;
  let element: HTMLElement;
  let saved: Mock<() => void>;

  async function setup(origins: string[] = []): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const loading = TestBed.inject(ServerSettingsService).load();
    http.expectOne('/api/settings').flush(configuredSettingsFixture({ embedding: { origins } }));
    await loading;
    fixture = TestBed.createComponent(EmbeddingSectionComponent);
    saved = vi.fn<() => void>();
    fixture.componentInstance.saved.subscribe(saved);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function textarea(): HTMLTextAreaElement {
    return element.querySelector<HTMLTextAreaElement>('#embedding-origins')!;
  }

  function type(value: string): void {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
  }

  async function submit(): Promise<void> {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  }

  function errorText(): string {
    return element.querySelector('#embedding-origins-error')?.textContent?.trim() ?? '';
  }

  afterEach(() => http.verify());

  it('shows the saved origins, one per line', async () => {
    await setup(['https://proxy.example.ch', 'https://*.example.com']);
    expect(textarea().value).toBe('https://proxy.example.ch\nhttps://*.example.com');
    expect(element.querySelector('label')?.textContent).toContain('Allowed origins, one per line');
  });

  it('saves the lines as typed and waits for Caddy', async () => {
    await setup();
    type('https://proxy.example.ch\n\nhttps://*.example.com');
    await submit();
    const request = http.expectOne('/api/settings/embedding');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      origins: ['https://proxy.example.ch', '', 'https://*.example.com'],
    });
    request.flush(configuredSettingsFixture());
    await flushMicrotasks();
    http.expectOne('/api/settings/status').flush(appliedStatusFixture());
    await render();
    expect(saved).toHaveBeenCalledOnce();
  });

  it('allows none', async () => {
    await setup(['https://proxy.example.ch']);
    type('');
    await submit();
    const request = http.expectOne('/api/settings/embedding');
    expect(request.request.body).toEqual({ origins: [''] });
    request.flush(configuredSettingsFixture());
    await flushMicrotasks();
    http.expectOne('/api/settings/status').flush(appliedStatusFixture());
    await render();
    expect(saved).toHaveBeenCalledOnce();
  });

  it('names the line that is not an origin', async () => {
    await setup();
    type('https://proxy.example.ch\nproxy.example.ch');
    await submit();
    expect(errorText()).toBe(
      'Line 2 is not an origin. Use https://host or https://*.host, optionally with a port.',
    );
    expect(textarea().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(textarea());
    http.expectNone('/api/settings/embedding');
  });

  it('clears the message when the text is edited', async () => {
    await setup();
    type('nope');
    await submit();
    type('https://proxy.example.ch');
    await render();
    expect(errorText()).toBe('');
  });

  it('refuses more origins than the server takes', async () => {
    await setup();
    type(Array.from({ length: 21 }, (_, index) => `https://h${index}.example.ch`).join('\n'));
    await submit();
    expect(errorText()).toBe('At most 20 origins are possible.');
  });

  it('shows the line the server refused', async () => {
    await setup();
    type('https://proxy.example.ch\nhttps://a.example.ch');
    await submit();
    http
      .expectOne('/api/settings/embedding')
      .flush(
        { code: 'validation_failed', errors: { 'origins[1]': ['origin_invalid'] } },
        { status: 400, statusText: 'Bad Request' },
      );
    await render();
    expect(errorText()).toContain('Line 2 is not an origin');
  });

  it('names the step in the wizard', async () => {
    await setup();
    fixture.componentRef.setInput('mode', 'next');
    await render();
    expect(element.querySelector('button[type="submit"]')?.textContent?.trim()).toBe(
      'Save and finish',
    );
  });
});
