import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PopoverDirective, PopoverService, PopoverTriggerDirective } from './popover.directive';

@Component({
  imports: [PopoverDirective, PopoverTriggerDirective],
  template: `
    <div class="c-pop-wrap">
      <button type="button" class="t-a" fsPopoverTrigger="a">A</button>
      @if (popovers.isOpen('a')) {
        <div class="c-pop p-a" role="dialog" aria-label="A" fsPopover="a">
          <button type="button" class="first">x</button>
        </div>
      }
    </div>
    <div class="c-pop-wrap">
      <button type="button" class="t-b" fsPopoverTrigger="b">B</button>
      @if (popovers.isOpen('b')) {
        <div class="c-pop p-b" role="dialog" aria-label="B" fsPopover="b" [popoverFocus]="false">
          <button type="button">y</button>
        </div>
      }
    </div>
    <p class="outside">draussen</p>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  constructor(readonly popovers: PopoverService) {}
}

describe('PopoverService and directives', () => {
  let fixture: ComponentFixture<HostComponent>;
  let element: HTMLElement;

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(HostComponent);
    element = fixture.nativeElement as HTMLElement;
    document.body.appendChild(element);
    await render();
  });

  afterEach(() => element.remove());

  const trigger = (name: string): HTMLButtonElement =>
    element.querySelector(`.t-${name}`) as HTMLButtonElement;

  it('toggles with aria-expanded and aria-controls, focusing the first item', async () => {
    expect(trigger('a').getAttribute('aria-expanded')).toBe('false');
    expect(trigger('a').getAttribute('aria-controls')).toBe('fs-pop-a');
    trigger('a').click();
    await render();
    expect(trigger('a').getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelector('.p-a')?.id).toBe('fs-pop-a');
    expect(document.activeElement?.className).toBe('first');
    trigger('a').click();
    await render();
    expect(element.querySelector('.p-a')).toBeNull();
  });

  it('keeps at most one popover open', async () => {
    trigger('a').click();
    await render();
    trigger('b').click();
    await render();
    expect(element.querySelector('.p-a')).toBeNull();
    expect(element.querySelector('.p-b')).not.toBeNull();
    expect(document.activeElement).not.toBe(element.querySelector('.p-b button'));
  });

  it('closes on an outside click but not on clicks inside', async () => {
    trigger('a').click();
    await render();
    (element.querySelector('.p-a button') as HTMLButtonElement).click();
    await render();
    expect(element.querySelector('.p-a')).not.toBeNull();
    (element.querySelector('.outside') as HTMLElement).click();
    await render();
    expect(element.querySelector('.p-a')).toBeNull();
  });

  it('closes on Escape and returns the focus to the trigger', async () => {
    trigger('a').click();
    await render();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await render();
    expect(element.querySelector('.p-a')).toBeNull();
    expect(document.activeElement).toBe(trigger('a'));
  });
});
