import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ContextMenuDirective,
  ContextMenuHostComponent,
  ContextMenuService,
  type ContextMenuEntry,
} from './context-menu';

@Component({
  imports: [ContextMenuDirective, ContextMenuHostComponent],
  template: `
    <button id="target" type="button" [sfContextMenu]="entries" sfContextMenuLabel="Scene Welcome">
      Welcome
    </button>
    <sf-context-menu-host />
  `,
})
class HostComponent {
  readonly ran = signal<string[]>([]);
  readonly entries = (): readonly ContextMenuEntry[] => [
    { label: 'Rename', shortcut: 'F2', run: () => this.ran.update((list) => [...list, 'rename']) },
    'separator',
    { label: 'Delete', danger: true, run: () => this.ran.update((list) => [...list, 'delete']) },
    { label: 'Disabled', disabled: true, run: () => this.ran.update((list) => [...list, 'off']) },
  ];
}

describe('ContextMenu', () => {
  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return { fixture, root, target: root.querySelector<HTMLButtonElement>('#target')! };
  }

  it('opens at the pointer on a right click with the commands, a separator and the shortcut hints', () => {
    const { fixture, root, target } = setup();
    target.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }),
    );
    fixture.detectChanges();
    expect(root.querySelector('[role=menu]')?.getAttribute('aria-label')).toBe('Scene Welcome');
    expect(
      [...root.querySelectorAll('[role=menuitem]')].map((item) => item.textContent?.trim()),
    ).toEqual(['RenameF2', 'Delete', 'Disabled']);
    expect(root.querySelectorAll('[role=separator]')).toHaveLength(1);
  });

  it('runs a command and closes', () => {
    const { fixture, root, target } = setup();
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('[role=menuitem]')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.ran()).toEqual(['rename']);
    expect(root.querySelector('[role=menu]')).toBeNull();
  });

  it('opens from the keyboard with Shift+F10 and never runs a disabled command', () => {
    const { fixture, root, target } = setup();
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(root.querySelector('[role=menu]')).not.toBeNull();
    TestBed.inject(ContextMenuService).run({
      label: 'x',
      disabled: true,
      run: () => fixture.componentInstance.ran.set(['x']),
    });
    expect(fixture.componentInstance.ran()).toEqual([]);
  });
});
