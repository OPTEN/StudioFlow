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
    for (const request of http.match('/api/settings/media/suggestions')) {
      request.flush({ fromHost: null, interfaces: [] });
    }
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

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function stepText(): string {
    return element.querySelector('.c-wizard__step')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function segments(): string[] {
    return Array.from(element.querySelectorAll('.c-wizard__seg')).map((segment) =>
      segment.classList.contains('is-done')
        ? 'done'
        : segment.classList.contains('is-current')
          ? 'current'
          : 'todo',
    );
  }

  afterEach(() => http.verify());

  it('starts with the media address as step 2 of 4, after the account', async () => {
    await setup();
    expect(element.querySelector('h2')?.textContent).toBe('Set up the server');
    expect(stepText()).toBe('Step 2 of 4 · Media address');
    expect(segments()).toEqual(['done', 'current', 'todo', 'todo']);
    expect(fixture.debugElement.query(By.directive(MediaSectionComponent))).not.toBeNull();
    expect(element.querySelector('#wizard-media')?.textContent).toBe('Media address');
  });

  it('says that the settings could not be read and tries again', async () => {
    await setup(null);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'could not read the settings',
    );
    (element.querySelector('.c-wizard__section button') as HTMLButtonElement).click();
    await render();
    answerSettings(serverSettingsFixture());
    await render();
    http
      .match('/api/settings/media/suggestions')
      .forEach((request) => request.flush({ fromHost: null, interfaces: [] }));
    await render();
    expect(stepText()).toBe('Step 2 of 4 · Media address');
  });

  it('goes through address and embedding, which can keep their defaults, to the end', async () => {
    await setup();
    fixture.debugElement.query(By.directive(MediaSectionComponent)).componentInstance.saved.emit();
    await render();
    expect(stepText()).toBe('Step 3 of 4 · Address and certificate');
    expect(segments()).toEqual(['done', 'done', 'current', 'todo']);
    expect(fixture.debugElement.query(By.directive(AddressSectionComponent))).not.toBeNull();

    (element.querySelector('.c-wizard__skip button') as HTMLButtonElement).click();
    await render();
    expect(stepText()).toBe('Step 4 of 4 · Embedding');
    expect(fixture.debugElement.query(By.directive(EmbeddingSectionComponent))).not.toBeNull();

    (element.querySelector('.c-wizard__skip button') as HTMLButtonElement).click();
    await render();
    expect(stepText()).toBe('The server is ready');
    expect(segments()).toEqual(['done', 'done', 'done', 'done']);
    expect(element.querySelector('.c-wizard__link')).toBeNull();
  });

  it('opens the Regie at the end', async () => {
    await setup(configuredSettingsFixture());
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture.debugElement.query(By.directive(MediaSectionComponent)).componentInstance.saved.emit();
    await render();
    fixture.debugElement
      .query(By.directive(AddressSectionComponent))
      .componentInstance.saved.emit('https://localhost:8443');
    await render();
    fixture.debugElement
      .query(By.directive(EmbeddingSectionComponent))
      .componentInstance.saved.emit();
    await render();
    (element.querySelector('.c-login__submit') as HTMLButtonElement).click();
    await render();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('points to the new address when the address was changed to another one', async () => {
    await setup();
    fixture.debugElement.query(By.directive(MediaSectionComponent)).componentInstance.saved.emit();
    await render();
    fixture.debugElement
      .query(By.directive(AddressSectionComponent))
      .componentInstance.saved.emit('https://studioflow.example.com:8443');
    await render();
    fixture.debugElement
      .query(By.directive(EmbeddingSectionComponent))
      .componentInstance.saved.emit();
    await render();
    const link = element.querySelector<HTMLAnchorElement>('.c-wizard__link')!;
    expect(link.getAttribute('href')).toBe('https://studioflow.example.com:8443');
    expect(link.textContent).toContain('Open https://studioflow.example.com:8443');
  });
});
