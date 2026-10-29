import { TestBed } from '@angular/core/testing';
import { KeyboardService, isTypingTarget } from './keyboard.service';

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key === ' ' ? 'Space' : init.code,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
}

describe('KeyboardService', () => {
  let keyboard: KeyboardService;
  const cleanup: (() => void)[] = [];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    keyboard = TestBed.inject(KeyboardService);
  });

  afterEach(() => {
    cleanup.splice(0).forEach((off) => off());
    document.body.innerHTML = '';
  });

  function focus(html: string): HTMLElement {
    document.body.innerHTML = html;
    const element = document.body.firstElementChild as HTMLElement;
    element.focus();
    return element;
  }

  it('maps 1–9 to scene indexes and prevents the default when handled', () => {
    const scenes: number[] = [];
    cleanup.push(keyboard.register('scene', (index) => (scenes.push(index), true)));
    expect(press('1').defaultPrevented).toBe(true);
    press('9');
    press('0');
    expect(scenes).toEqual([0, 8]);
  });

  it('maps ? to the help shortcut, but not while typing', () => {
    let calls = 0;
    cleanup.push(keyboard.register('help', () => (calls++, true)));
    expect(press('?', { shiftKey: true }).defaultPrevented).toBe(true);
    press('?', { shiftKey: true, repeat: true });
    focus('<input type="text">');
    press('?', { shiftKey: true });
    expect(calls).toBe(1);
  });

  it('closes an open sheet with Escape before anything else', () => {
    const order: string[] = [];
    cleanup.push(keyboard.registerEscape('popover', () => (order.push('popover'), true)));
    cleanup.push(keyboard.registerEscape('sheet', () => (order.push('sheet'), true)));
    press('Escape');
    expect(order).toEqual(['sheet']);
  });

  it('maps M to the mute shortcut of the audio mixer and leaves it alone when nothing handles it', () => {
    const calls: string[] = [];
    cleanup.push(keyboard.register('mute', () => (calls.push('mute'), true)));
    expect(press('m').defaultPrevented).toBe(true);
    expect(press('M').defaultPrevented).toBe(true);
    press('m', { repeat: true });
    press('m', { ctrlKey: true });
    focus('<input type="text">');
    press('m');
    expect(calls).toEqual(['mute', 'mute']);

    cleanup.splice(0).forEach((off) => off());
    document.body.innerHTML = '';
    expect(press('m').defaultPrevented).toBe(false);
  });

  it('ignores shortcuts while typing, but not Escape', () => {
    const scenes: number[] = [];
    let escapes = 0;
    cleanup.push(keyboard.register('scene', (index) => (scenes.push(index), true)));
    cleanup.push(keyboard.registerEscape('selection', () => (escapes++, true)));
    for (const html of [
      '<input type="text">',
      '<select><option>1</option></select>',
      '<textarea></textarea>',
    ]) {
      focus(html);
      press('2');
      press('Escape');
    }
    expect(scenes).toEqual([]);
    expect(escapes).toBe(3);
  });

  it('detects text fields', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('runs Space as take unless a button or link has the focus', () => {
    let takes = 0;
    cleanup.push(keyboard.register('take', () => (takes++, true)));
    expect(press(' ').defaultPrevented).toBe(true);
    focus('<button type="button">x</button>');
    press(' ');
    focus('<a href="#">x</a>');
    press(' ');
    expect(takes).toBe(1);
  });

  it('does not prevent Space when take is not handled', () => {
    cleanup.push(keyboard.register('take', () => false));
    expect(press(' ').defaultPrevented).toBe(false);
  });

  it('ignores auto-repeat of Space and digits', () => {
    let calls = 0;
    cleanup.push(keyboard.register('take', () => (calls++, true)));
    cleanup.push(keyboard.register('scene', () => (calls++, true)));
    press(' ', { repeat: true });
    press('3', { repeat: true });
    expect(calls).toBe(0);
  });

  it('maps Ctrl+Z to undo and Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y to redo', () => {
    const calls: string[] = [];
    cleanup.push(keyboard.register('undo', () => (calls.push('undo'), true)));
    cleanup.push(keyboard.register('redo', () => (calls.push('redo'), true)));
    expect(press('z', { ctrlKey: true }).defaultPrevented).toBe(true);
    press('Z', { ctrlKey: true, shiftKey: true });
    press('z', { metaKey: true, shiftKey: true });
    press('y', { ctrlKey: true });
    press('z', { metaKey: true });
    expect(calls).toEqual(['undo', 'redo', 'redo', 'redo', 'undo']);
  });

  it('leaves other modifier combinations and digits with modifiers to the browser', () => {
    let calls = 0;
    cleanup.push(keyboard.register('scene', () => (calls++, true)));
    press('1', { ctrlKey: true });
    press('1', { altKey: true });
    press('1', { metaKey: true });
    expect(calls).toBe(0);
  });

  it('handles Escape by the first open layer in priority order', () => {
    const order: string[] = [];
    let popoverOpen = true;
    cleanup.push(keyboard.registerEscape('selection', () => (order.push('selection'), true)));
    cleanup.push(keyboard.registerEscape('pairing', () => (order.push('pairing'), false)));
    cleanup.push(
      keyboard.registerEscape('popover', () => {
        order.push('popover');
        const was = popoverOpen;
        popoverOpen = false;
        return was;
      }),
    );
    cleanup.push(keyboard.registerEscape('dockDrag', () => (order.push('dockDrag'), false)));
    cleanup.push(keyboard.registerEscape('listDrag', () => (order.push('listDrag'), false)));
    press('Escape');
    press('Escape');
    expect(order).toEqual([
      'listDrag',
      'dockDrag',
      'popover',
      'listDrag',
      'dockDrag',
      'popover',
      'pairing',
      'selection',
    ]);
  });

  it('runs the newest handler first and survives throwing handlers', () => {
    const calls: string[] = [];
    cleanup.push(keyboard.register('scene', () => (calls.push('old'), true)));
    const off = keyboard.register('scene', () => {
      calls.push('new');
      throw new Error('broken');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    press('4');
    off();
    press('4');
    warn.mockRestore();
    expect(calls).toEqual(['new', 'old', 'old']);
  });
});
