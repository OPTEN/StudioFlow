import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { resetLocaleForTests } from '@studioflow/i18n';
import { pressKey, stubRowLayout } from '../testing/sortable-test-kit';
import { SortableItemDirective, SortableListComponent } from './sortable-list.component';

@Component({
  imports: [SortableListComponent, SortableItemDirective],
  template: `
    <sf-sortable-list [ids]="ids()" label="Dinge" [nameOf]="nameOf">
      <ng-template sfSortableItem let-id
        ><span>{{ id }}</span></ng-template
      >
    </sf-sortable-list>
  `,
})
class HostComponent {
  readonly ids = signal(['a', 'b', 'c']);
  readonly nameOf = (id: string): string => id.toUpperCase();
}

describe('SortableListComponent in German', () => {
  beforeEach(() => {
    resetLocaleForTests('de-CH');
    vi.useFakeTimers();
    stubRowLayout();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.querySelector('[aria-live]')?.remove();
  });

  it('names the handle and announces every step in German', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    const handle = fixture.nativeElement.querySelector('.c-sortable__handle') as HTMLElement;
    const announced = (): string => {
      vi.advanceTimersByTime(50);
      return document.body.querySelector('[aria-live]')?.textContent ?? '';
    };
    expect(handle.getAttribute('aria-label')).toBe('Verschieben: A');
    handle.focus();
    pressKey(handle, ' ');
    expect(announced()).toBe(
      'A aufgenommen an Position 1 von 3. Mit den Pfeiltasten bewegen, mit der Leertaste ablegen, mit Escape abbrechen.',
    );
    pressKey(handle, 'ArrowDown');
    expect(announced()).toBe('A verschoben an Position 2 von 3.');
    pressKey(handle, ' ');
    expect(announced()).toBe('A abgelegt an Position 2 von 3.');
    pressKey(handle, ' ');
    pressKey(handle, 'Escape');
    expect(announced()).toBe('Verschieben abgebrochen. A ist wieder an Position 1 von 3.');
    fixture.nativeElement.remove();
  });
});
