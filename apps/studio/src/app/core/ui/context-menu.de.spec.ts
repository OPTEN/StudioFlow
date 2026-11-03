import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { resetLocaleForTests, t } from '@studioflow/i18n';
import { I18N } from '@studioflow/i18n/angular';
import {
  ContextMenuDirective,
  ContextMenuHostComponent,
  type ContextMenuEntry,
} from './context-menu';

describe('ContextMenu when the language changes while it is open', () => {
  @Component({
    imports: [ContextMenuDirective, ContextMenuHostComponent],
    template: `
      <button
        id="target"
        type="button"
        [sfContextMenu]="entries"
        [sfContextMenuLabel]="t('regie.scenes.row.menuLabel', { name: 'Break' })"
      >
        Break
      </button>
      <sf-context-menu-host />
    `,
  })
  class LocalizedHostComponent {
    protected readonly t = t;
    readonly entries = (): readonly ContextMenuEntry[] => [
      { label: t('regie.scenes.row.deleteLive'), danger: true, run: () => undefined },
    ];
  }

  afterEach(() => resetLocaleForTests());

  it('re-words the entries and the accessible name of the open menu', () => {
    resetLocaleForTests('en');
    const i18n = TestBed.inject(I18N);
    const fixture = TestBed.createComponent(LocalizedHostComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    root
      .querySelector('#target')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    const menu = (): HTMLElement => root.querySelector<HTMLElement>('[role=menu]')!;
    const label = (): string | undefined =>
      menu().querySelector('.c-ctx__label')?.textContent?.trim();
    expect(menu().getAttribute('aria-label')).toBe('Scene Break');
    expect(label()).toBe('Delete… (not while live)');

    i18n.setSetting('de-CH');
    fixture.detectChanges();

    expect(menu().getAttribute('aria-label')).toBe('Szene Break');
    expect(label()).toBe('Löschen … (nicht, solange live)');
  });
});
