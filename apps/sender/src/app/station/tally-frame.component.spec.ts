import { TestBed } from '@angular/core/testing';
import type { TallyState } from '@flowstudio/scene-model';
import { TallyFrameComponent } from './tally-frame.component';

describe('TallyFrameComponent', () => {
  function render(state: TallyState, thin = false): HTMLElement {
    const fixture = TestBed.createComponent(TallyFrameComponent);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('thin', thin);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('program: red frame with «LIVE» and spoken text', () => {
    const element = render('program');
    const frame = element.querySelector<HTMLElement>('[data-testid=tally]')!;

    expect(frame.dataset['tally']).toBe('program');
    expect(frame.classList).toContain('is-program');
    expect(frame.textContent?.trim()).toBe('LIVE');
    expect(element.querySelector('[aria-live]')?.textContent).toContain('im Program');
  });

  it('preview: green frame with «Als Nächstes»', () => {
    const element = render('preview');
    const frame = element.querySelector<HTMLElement>('[data-testid=tally]')!;

    expect(frame.classList).toContain('is-preview');
    expect(frame.textContent?.trim()).toBe('Als Nächstes');
  });

  it('off: no frame, no badge', () => {
    const element = render('off');
    const frame = element.querySelector<HTMLElement>('[data-testid=tally]')!;

    expect(frame.classList).not.toContain('is-program');
    expect(frame.classList).not.toContain('is-preview');
    expect(frame.textContent?.trim()).toBe('');
    expect(element.querySelector('[aria-live]')?.textContent).toContain('Nicht auf Sendung');
  });

  it('thin frame in dark mode', () => {
    const element = render('program', true);
    expect(element.querySelector('[data-testid=tally]')?.classList).toContain('c-tally--thin');
  });
});
