import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { flushMicrotasks } from '../../testing/fake-studio-hub';
import { configuredSettingsFixture, serverSettingsFixture } from '../../testing/settings-fixtures';
import { csrfInterceptor } from '../core/api/csrf.interceptor';
import { MediaTestService } from '../core/media/media-test.service';
import { AddressSectionComponent } from './address-section.component';
import { EmbeddingSectionComponent } from './embedding-section.component';
import { MediaSectionComponent } from './media-section.component';
import { ServerWizardComponent } from './server-wizard.component';

describe('ServerWizardComponent', () => {
  let fixture: ComponentFixture<ServerWizardComponent>;
  let http: HttpTestingController;
  let element: HTMLElement;

  async function setup(answer: object | null = serverSettingsFixture()): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: MediaTestService,
          useValue: {
            isOpen: false,
            run: vi.fn(),
            markSaved: vi.fn(),
            end: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ServerWizardComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
    answerSettings(answer);
    await render();
    answerSuggestions();
    await render();
  }

  function answerSettings(answer: object | null): void {
    const request = http.expectOne('/api/settings');
    if (answer) {
      request.flush(answer);
    } else {
      request.flush({}, { status: 500, statusText: 'Server Error' });
    }
  }

  function answerSuggestions(): void {
    for (const request of http.match('/api/settings/media/suggestions')) {
      request.flush({ fromHost: null, interfaces: [] });
    }
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function title(): string {
    return element.querySelector('h1')?.textContent?.trim() ?? '';
  }

  /** The steps of the indicator: done, current or still to do. */
  function steps(): string[] {
    return Array.from(element.querySelectorAll('.c-steps__item')).map((step) =>
      step.classList.contains('is-done')
        ? 'done'
        : step.getAttribute('aria-current') === 'step'
          ? 'current'
          : 'todo',
    );
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === label,
    );
    if (!found) {
      throw new Error(`no button "${label}"`);
    }
    return found;
  }

  function section<T>(type: new (...args: never[]) => T): T {
    return fixture.debugElement.query(By.directive(type)).componentInstance as T;
  }

  afterEach(() => http.verify());

  it('starts with the media server, after the account, in the labelled steps of the first run', async () => {
    await setup();
    expect(title()).toBe('Connect the media server');
    expect(steps()).toEqual(['done', 'current', 'todo', 'todo', 'todo']);
    expect(element.querySelector('[aria-current="step"]')?.textContent).toContain('Media server');
    expect(fixture.debugElement.query(By.directive(MediaSectionComponent))).not.toBeNull();
    expect(element.textContent).not.toContain('Keep the defaults');
  });

  it('says that the settings could not be read and tries again', async () => {
    await setup(null);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'could not read the settings',
    );
    button('Try again').click();
    await render();
    answerSettings(serverSettingsFixture());
    await render();
    answerSuggestions();
    await render();
    expect(title()).toBe('Connect the media server');
  });

  it('goes through address and embedding, which can keep their defaults, to the end', async () => {
    await setup();
    section(MediaSectionComponent).saved.emit();
    await render();
    expect(title()).toBe('Choose how browsers reach the server');
    expect(steps()).toEqual(['done', 'done', 'current', 'todo', 'todo']);
    expect(fixture.debugElement.query(By.directive(AddressSectionComponent))).not.toBeNull();
    expect(element.querySelector('.c-wizard__keep')?.textContent).toContain(
      'keeps its local certificate',
    );

    button('Keep the defaults').click();
    await render();
    expect(title()).toBe('Allow websites to show the output');
    expect(fixture.debugElement.query(By.directive(EmbeddingSectionComponent))).not.toBeNull();
    expect(element.querySelector('.c-wizard__keep')?.textContent).toContain(
      'no other website may show the output',
    );

    button('Keep the defaults').click();
    await render();
    expect(title()).toBe('The server is ready');
    expect(steps()).toEqual(['done', 'done', 'done', 'done', 'current']);
    expect(element.querySelector('.c-wizard__link')).toBeNull();
  });

  it('goes back one step, and the focus moves to the title of each new step', async () => {
    await setup();
    document.body.append(element);
    section(MediaSectionComponent).saved.emit();
    await render();
    button('Keep the defaults').click();
    await render();
    expect(document.activeElement).toBe(element.querySelector('h1'));

    button('Back').click();
    await render();
    expect(title()).toBe('Choose how browsers reach the server');
    button('Back').click();
    await render();
    answerSuggestions();
    await render();
    expect(title()).toBe('Connect the media server');
    expect(element.textContent).not.toContain('Back');
    element.remove();
  });

  it('opens the Regie at the end', async () => {
    await setup(configuredSettingsFixture());
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    section(MediaSectionComponent).saved.emit();
    await render();
    section(AddressSectionComponent).saved.emit('https://localhost:8443');
    await render();
    section(EmbeddingSectionComponent).saved.emit();
    await render();
    button('Open the control room').click();
    await render();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('leads to the new address when the address was changed to another one', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    section(MediaSectionComponent).saved.emit();
    await render();
    section(AddressSectionComponent).saved.emit('https://studioflow.example.com:8443');
    await render();
    section(EmbeddingSectionComponent).saved.emit();
    await render();
    const link = element.querySelector<HTMLAnchorElement>('.c-wizard__link')!;
    expect(link.getAttribute('href')).toBe('https://studioflow.example.com:8443');
    expect(link.textContent).toContain('Open https://studioflow.example.com:8443');
    expect(link.classList).toContain('c-btn--fill');
    button('Stay at this address').click();
    await render();
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
