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

  function fields(): HTMLInputElement[] {
    return Array.from(element.querySelectorAll<HTMLInputElement>('input[id^="embedding-origin-"]'));
  }

  function type(index: number, value: string): void {
    fields()[index].value = value;
    fields()[index].dispatchEvent(new Event('input'));
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) =>
        candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
    );
    if (!found) {
      throw new Error(`no button "${label}"`);
    }
    return found;
  }

  async function add(value: string): Promise<void> {
    button('Add website').click();
    await render();
    type(fields().length - 1, value);
  }

  async function submit(): Promise<void> {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  }

  function errorOf(field: HTMLInputElement): string {
    return element.querySelector(`#${field.id}-error`)?.textContent?.trim() ?? '';
  }

  /** Answers the save and the poll for Caddy. */
  async function accept(origins: string[]): Promise<void> {
    const request = http.expectOne('/api/settings/embedding');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ origins });
    request.flush(configuredSettingsFixture());
    await flushMicrotasks();
    http.expectOne('/api/settings/status').flush(appliedStatusFixture());
    await render();
  }

  afterEach(() => http.verify());

  it('shows the saved websites, one row each with its own label and remove button', async () => {
    await setup(['https://proxy.example.ch', 'https://*.example.com']);
    expect(fields().map((field) => field.value)).toEqual([
      'https://proxy.example.ch',
      'https://*.example.com',
    ]);
    expect(fields().map((field) => field.getAttribute('aria-label'))).toEqual([
      'Website 1',
      'Website 2',
    ]);
    expect(button('Remove website 2')).toBeDefined();
    expect(element.querySelector('h2')?.textContent?.trim()).toBe('Allowed websites');
  });

  it('says that no website may show the output, and offers to add one', async () => {
    await setup();
    expect(fields()).toEqual([]);
    expect(element.textContent).toContain('No website may show the output yet.');
    button('Add website').click();
    await render();
    expect(fields()).toHaveLength(1);
    expect(document.activeElement).toBe(fields()[0]);
  });

  it('saves the filled rows trimmed, ignores empty ones and waits for Caddy', async () => {
    await setup();
    await add(' https://proxy.example.ch ');
    await add('');
    await add('https://*.example.com');
    await submit();
    await accept(['https://proxy.example.ch', 'https://*.example.com']);
    expect(saved).toHaveBeenCalledOnce();
    expect(fields().map((field) => field.value)).toEqual([
      'https://proxy.example.ch',
      'https://*.example.com',
    ]);
  });

  it('allows none', async () => {
    await setup(['https://proxy.example.ch']);
    button('Remove website 1').click();
    await render();
    expect(document.activeElement?.textContent?.trim()).toBe('Add website');
    await submit();
    await accept([]);
    expect(saved).toHaveBeenCalledOnce();
  });

  it('checks a row as soon as it is left and names the row that is not a website', async () => {
    await setup();
    await add('https://proxy.example.ch');
    await add('proxy.example.ch');
    fields()[1].dispatchEvent(new Event('blur'));
    await render();
    expect(errorOf(fields()[1])).toBe(
      'This is not a website address. Use https://host or https://*.host, optionally with a port.',
    );
    expect(fields()[1].getAttribute('aria-invalid')).toBe('true');
    expect(errorOf(fields()[0])).toBe('');

    await submit();
    await render();
    expect(document.activeElement).toBe(fields()[1]);
    http.expectNone('/api/settings/embedding');
  });

  it('clears the message when the row is edited', async () => {
    await setup();
    await add('nope');
    await submit();
    await render();
    expect(errorOf(fields()[0])).not.toBe('');
    type(0, 'https://proxy.example.ch');
    await render();
    expect(errorOf(fields()[0])).toBe('');
  });

  it('stops adding at the number of websites the server takes, and says why', async () => {
    await setup(Array.from({ length: 20 }, (_, index) => `https://h${index}.example.ch`));
    const addButton = button('Add website');
    expect(addButton.disabled).toBe(true);
    expect(
      element.querySelector(`#${addButton.getAttribute('aria-describedby')}`)?.textContent,
    ).toContain('At most 20 websites are possible.');
  });

  it('shows the row the server refused', async () => {
    await setup();
    await add('https://proxy.example.ch');
    await add('https://a.example.ch');
    await submit();
    http
      .expectOne('/api/settings/embedding')
      .flush(
        { code: 'validation_failed', errors: { 'origins[1]': ['origin_invalid'] } },
        { status: 400, statusText: 'Bad Request' },
      );
    await render();
    expect(errorOf(fields()[1])).toContain('This is not a website address');
    expect(errorOf(fields()[0])).toBe('');
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
