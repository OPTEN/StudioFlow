import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { tFor } from '@studioflow/i18n';
import { injectI18n } from '@studioflow/i18n/angular';
import { StudioTitleStrategy, documentTitle } from './studio-title.strategy';

describe('StudioTitleStrategy', () => {
  function setup(): { router: Router; title: Title } {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', children: [], data: { titleKey: 'regie.login.title' } },
          { path: 'plain', children: [] },
        ]),
        { provide: TitleStrategy, useClass: StudioTitleStrategy },
      ],
    });
    return { router: TestBed.inject(Router), title: TestBed.inject(Title) };
  }

  it('builds the document title from the title key of the route', async () => {
    const { router, title } = setup();
    await router.navigateByUrl('/login');
    TestBed.tick();
    expect(title.getTitle()).toBe('Sign in · StudioFlow Control room');
  });

  it('falls back to the app title for a route without a key', async () => {
    const { router, title } = setup();
    await router.navigateByUrl('/plain');
    TestBed.tick();
    expect(title.getTitle()).toBe('StudioFlow Control room');
  });

  it('rebuilds the title when the language changes', async () => {
    const { router, title } = setup();
    const i18n = TestBed.runInInjectionContext(() => injectI18n());
    await router.navigateByUrl('/login');
    TestBed.tick();
    expect(title.getTitle()).toBe('Sign in · StudioFlow Control room');
    i18n.setSetting('de-CH');
    TestBed.tick();
    expect(title.getTitle()).toBe(
      tFor('de-CH')('regie.login.title') + ' · ' + tFor('de-CH')('regie.core.appTitle'),
    );
  });

  it('puts the status of the control room in front of the app title', async () => {
    const { router, title } = setup();
    const strategy = TestBed.inject(TitleStrategy) as StudioTitleStrategy;
    await router.navigateByUrl('/plain');
    strategy.setStatus('● On air · 2 issues · Webinar');
    TestBed.tick();
    expect(title.getTitle()).toBe('● On air · 2 issues · Webinar · StudioFlow Control room');
    strategy.setStatus(null);
    TestBed.tick();
    expect(title.getTitle()).toBe('StudioFlow Control room');
  });

  it('keeps the page title on pages with a title key', async () => {
    const { router, title } = setup();
    const strategy = TestBed.inject(TitleStrategy) as StudioTitleStrategy;
    strategy.setStatus('● On air · Webinar');
    await router.navigateByUrl('/login');
    TestBed.tick();
    expect(title.getTitle()).toBe('Sign in · StudioFlow Control room');
  });

  it('writes the same title with documentTitle', () => {
    expect(documentTitle(null)).toBe('StudioFlow Control room');
    expect(documentTitle('regie.monitoring.title')).toBe('Monitoring · StudioFlow Control room');
    expect(documentTitle(null, '● On air · Webinar')).toBe(
      '● On air · Webinar · StudioFlow Control room',
    );
  });
});
