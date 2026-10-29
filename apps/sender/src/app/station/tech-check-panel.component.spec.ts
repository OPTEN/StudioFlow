import { TestBed } from '@angular/core/testing';
import { msg } from '@studioflow/i18n';
import type { TechCheckResult } from '@studioflow/media-client/device';
import { TECH_CHECK_OK } from '../../testing/sender-fakes';
import { TechCheckPanelComponent, techCheckNote } from './tech-check-panel.component';

const SLOW: TechCheckResult = {
  ...TECH_CHECK_OK,
  overall: 'warn',
  bandwidth: 'warn',
  uploadKbps: 2800,
  note: 'Upload: only 2.8 Mbit/s (recommended from 6 Mbit/s).',
  problems: [msg('media.techcheck.upload.slow', { rate: 2.8, recommended: 6 })],
};

describe('TechCheckPanelComponent', () => {
  function render(result: TechCheckResult | null): HTMLElement {
    const fixture = TestBed.createComponent(TechCheckPanelComponent);
    fixture.componentRef.setInput('result', result);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the verdict, the lamps and the problems in English', () => {
    const element = render(SLOW);
    expect(element.querySelector('h2')?.textContent).toContain('Tech check');
    expect(element.querySelector('.c-check__summary')?.textContent).toContain(
      'It works, but with limitations.',
    );
    expect(element.querySelector('.c-check__note')?.textContent).toBe(
      'Upload: only 2.8 Mbit/s (recommended from 6 Mbit/s).',
    );
    expect(element.textContent).toContain('2.8 Mbit/s');
    expect(element.querySelector('button.c-btn--primary')?.textContent).toContain('Check again');
  });

  it('is a dialog named by its title, with advice for a limited row', () => {
    const element = render(SLOW);
    const dialog = element.querySelector('dialog');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('tech-check-title');
    expect(element.querySelector('#tech-check-title')?.textContent).toContain('Tech check');
    expect(element.querySelector('[data-level=warn]')?.textContent).toContain(
      'Stop other uploads and video calls on this network.',
    );
    expect(element.querySelector('[data-level=ok]')?.textContent).not.toContain('Move closer');
  });

  it('offers the language select on the tab about this device', () => {
    const fixture = TestBed.createComponent(TechCheckPanelComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const tabs = [...element.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Check', 'This device']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    const devicePanel = element.querySelector<HTMLElement>('#tech-check-panel-device');
    expect(devicePanel?.hidden).toBe(true);

    tabs[1]?.click();
    fixture.detectChanges();
    expect(devicePanel?.hidden).toBe(false);
    expect(devicePanel?.querySelector('sf-language-select select')).not.toBeNull();
    expect(devicePanel?.textContent).toContain('App version');
    expect(element.querySelector<HTMLElement>('#tech-check-panel-check')?.hidden).toBe(true);
  });

  it('moves between the tabs with the arrow keys', () => {
    const fixture = TestBed.createComponent(TechCheckPanelComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const list = element.querySelector('[role=tablist]')!;

    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(element.querySelector('#tech-check-tab-device')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(element.querySelector('#tech-check-tab-check')?.getAttribute('tabindex')).toBe('-1');

    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    fixture.detectChanges();
    expect(element.querySelector('#tech-check-tab-check')?.getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('techCheckNote', () => {
  it('falls back to the note of a check stored by an older version', () => {
    const stored: TechCheckResult = { ...SLOW, note: 'Upload: only 2.8 Mbit/s.', problems: [] };
    expect(techCheckNote(stored)).toBe('Upload: only 2.8 Mbit/s.');
    expect(techCheckNote(null)).toBeNull();
    expect(techCheckNote(TECH_CHECK_OK)).toBeNull();
  });
});
