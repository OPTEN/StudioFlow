import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TallyState } from '@studioflow/scene-model';
import { TallyTagComponent } from './tally-tag.component';
import { TallyFrameComponent } from './tally-frame.component';

describe('TallyFrameComponent', () => {
  let fixture: ComponentFixture<TallyFrameComponent>;

  function render(state: TallyState, thin = false): HTMLElement {
    fixture = TestBed.createComponent(TallyFrameComponent);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('thin', thin);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function spoken(element: HTMLElement): string {
    return element.querySelector('[aria-live]')?.textContent?.trim() ?? '';
  }

  afterEach(() => TestBed.resetTestingModule());

  it('program: red frame without text of its own, and the spoken state', () => {
    const element = render('program');
    const frame = element.querySelector<HTMLElement>('[data-testid=tally]')!;

    expect(frame.dataset['tally']).toBe('program');
    expect(frame.classList).toContain('is-program');
    expect(frame.textContent?.trim()).toBe('');
    expect(spoken(element)).toContain('on Program');
  });

  it('preview: green frame and the spoken state', () => {
    const element = render('preview');
    const frame = element.querySelector<HTMLElement>('[data-testid=tally]')!;

    expect(frame.classList).toContain('is-preview');
    expect(spoken(element)).toBe('Preview: this device is ready to go live next.');
  });

  it('off: no frame; a station that opens off air says nothing, leaving the air says “Not live”', () => {
    const element = render('off');
    const frame = element.querySelector<HTMLElement>('[data-testid=tally]')!;

    expect(frame.classList).not.toContain('is-program');
    expect(frame.classList).not.toContain('is-preview');
    expect(spoken(element)).toBe('');

    fixture.componentRef.setInput('state', 'program');
    fixture.detectChanges();
    fixture.componentRef.setInput('state', 'off');
    fixture.detectChanges();
    expect(spoken(element)).toBe('Not live.');
  });

  it('thin frame while the screen is off', () => {
    const element = render('program', true);
    expect(element.querySelector('[data-testid=tally]')?.classList).toContain('c-tally--thin');
  });
});

describe('TallyTagComponent', () => {
  function render(state: TallyState): HTMLElement {
    const fixture = TestBed.createComponent(TallyTagComponent);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('testId', 'tally-tag');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('says “Live” in a red capsule, “Preview” in a green one and nothing off air', () => {
    expect(render('program').querySelector('.c-tag--pgm')?.textContent?.trim()).toBe('Live');
    expect(render('preview').querySelector('.c-tag--pvw')?.textContent?.trim()).toBe('Preview');
    expect(render('off').querySelector('[data-testid=tally-tag]')).toBeNull();
  });
});
