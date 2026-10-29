import { TestBed } from '@angular/core/testing';
import { MemoryStorage } from '../../../testing/store-harness';
import { BROWSER_STORAGE, PREFERENCE_KEYS } from '../../core/ui/preferences.service';
import { ToastService } from '../../core/ui/toast.service';
import {
  defaultLayout,
  moveDock,
  pairSlot,
  stepTarget,
  validateLayout,
  visibleZones,
  type DockLayout,
} from './dock-layout';
import { DockLayoutService } from './dock-layout.service';

function layoutWith(overrides: Partial<DockLayout>): DockLayout {
  return { ...defaultLayout(), ...overrides };
}

describe('dock layout model', () => {
  it('accepts a complete stored layout and fills missing optional values', () => {
    const layout = validateLayout({
      v: 1,
      zones: { left: ['scenes'], bottom: ['src', 'insp', 'audio'], right: ['st'] },
      weights: { src: 1.5 },
      leftW: 300,
    });
    expect(layout).not.toBeNull();
    expect(layout?.zones).toEqual({
      left: ['scenes'],
      bottom: ['src', 'insp', 'audio'],
      right: ['st'],
    });
    expect(layout?.weights.src).toBe(1.5);
    expect(layout?.weights.insp).toBe(1.2);
    expect(layout?.leftW).toBe(300);
    expect(layout?.rightW).toBe(340);
    expect(layout?.hidden).toEqual([]);
  });

  it.each([
    ['no object', null],
    ['wrong version', { v: 2, zones: defaultLayout().zones }],
    ['a dock missing', { v: 1, zones: { left: [], bottom: ['scenes', 'src', 'insp'], right: [] } }],
    [
      'a dock twice',
      {
        v: 1,
        zones: { left: ['st'], bottom: ['scenes', 'src', 'insp', 'st', 'audio'], right: [] },
      },
    ],
    [
      'an unknown dock',
      { v: 1, zones: { left: ['chat'], bottom: ['scenes', 'src', 'insp', 'st'], right: [] } },
    ],
    [
      'a zone that is no list',
      { v: 1, zones: { left: 'st', bottom: ['scenes', 'src', 'insp'], right: [] } },
    ],
    ['a negative weight', { ...defaultLayout(), weights: { scenes: -1 } }],
    ['an unknown hidden dock', { ...defaultLayout(), hidden: ['chat'] }],
    ['a bottom height of 2', { ...defaultLayout(), bottomH: 2 }],
    ['a side width of 10', { ...defaultLayout(), leftW: 10 }],
    ['a split of 0.9', { ...defaultLayout(), split: 0.9 }],
    ['a split that is text', { ...defaultLayout(), split: '0.5' }],
  ])('rejects %s', (_name, raw) => {
    expect(validateLayout(raw)).toBeNull();
  });

  it('adds the Audio dock to the end of the bottom zone of a layout stored before it existed', () => {
    const stored = {
      v: 1,
      zones: { left: ['scenes'], bottom: ['src', 'insp'], right: ['st'] },
      hidden: ['insp'],
    };
    const layout = validateLayout(stored);
    expect(layout?.zones).toEqual({
      left: ['scenes'],
      bottom: ['src', 'insp', 'audio'],
      right: ['st'],
    });
    expect(layout?.hidden).toEqual(['insp']);
    expect(layout?.weights.audio).toBe(defaultLayout().weights.audio);
    // The migrated layout is a complete layout: it validates again as it is.
    expect(validateLayout(layout)).toEqual(layout);
    // The old default arrangement becomes the new default arrangement.
    expect(
      validateLayout({
        v: 1,
        zones: { left: [], bottom: ['scenes', 'src', 'insp', 'st'], right: [] },
      })?.zones,
    ).toEqual(defaultLayout().zones);
  });

  it('shows the Audio dock after Stations by default', () => {
    expect(defaultLayout().zones.bottom).toEqual(['scenes', 'src', 'insp', 'st', 'audio']);
  });

  it('moves docks and reports unchanged moves', () => {
    const layout = defaultLayout();
    const moved = moveDock(layout, 'st', 'right', 0);
    expect(moved.zones).toEqual({
      left: [],
      bottom: ['scenes', 'src', 'insp', 'audio'],
      right: ['st'],
    });
    expect(moveDock(layout, 'scenes', 'bottom', 0)).toBe(layout);
    expect(moveDock(layout, 'scenes', 'bottom', 99).zones.bottom).toEqual([
      'src',
      'insp',
      'st',
      'audio',
      'scenes',
    ]);
  });

  it('steps through left → bottom → right with the grip keys', () => {
    const layout = defaultLayout();
    expect(stepTarget(layout, 'scenes', -1)).toEqual({ zone: 'left', index: 0 });
    expect(stepTarget(layout, 'audio', 1)).toEqual({ zone: 'right', index: 0 });
    expect(stepTarget(layout, 'src', 1)).toEqual({ zone: 'bottom', index: 2 });
    const left = layoutWith({
      zones: { left: ['scenes'], bottom: ['src', 'insp', 'st', 'audio'], right: [] },
    });
    expect(stepTarget(left, 'scenes', -1)).toBeNull();
    expect(stepTarget(left, 'scenes', 1)).toEqual({ zone: 'bottom', index: 0 });
  });

  it('puts the pairing dock in place of Sources and Properties', () => {
    // The Audio dock of the same zone steps aside too: the pairing dock keeps the width it has always had.
    expect(visibleZones(defaultLayout(), true).bottom).toEqual(['scenes', 'pair', 'st']);
    const sides = layoutWith({
      zones: { left: ['insp'], bottom: ['scenes', 'src', 'audio'], right: ['st'] },
    });
    expect(pairSlot(sides)).toEqual({ zone: 'left', index: 0 });
    expect(visibleZones(sides, true)).toEqual({
      left: ['pair'],
      bottom: ['scenes', 'audio'],
      right: ['st'],
    });
    const hidden = layoutWith({
      hidden: ['src', 'insp'],
      zones: { left: [], bottom: ['scenes', 'src', 'insp', 'audio'], right: ['st'] },
    });
    expect(pairSlot(hidden)).toEqual({ zone: 'right', index: 0 });
  });

  it('lets the Audio dock step aside only in the zone of the pairing dock, wherever it stands', () => {
    // Audio before Sources: the pairing dock still takes the place of Sources, after Scenes.
    const first = layoutWith({
      zones: { left: [], bottom: ['scenes', 'audio', 'src', 'insp', 'st'], right: [] },
    });
    expect(pairSlot(first)).toEqual({ zone: 'bottom', index: 2 });
    expect(visibleZones(first, true).bottom).toEqual(['scenes', 'pair', 'st']);
    // Audio in another zone stays where it is.
    const apart = layoutWith({
      zones: { left: [], bottom: ['scenes', 'src', 'insp', 'st'], right: ['audio'] },
    });
    expect(visibleZones(apart, true)).toEqual({
      left: [],
      bottom: ['scenes', 'pair', 'st'],
      right: ['audio'],
    });
    // Sources and Properties hidden: the pairing dock goes before Stations, and Audio gives way as well.
    const none = layoutWith({
      hidden: ['src', 'insp'],
      zones: { left: [], bottom: ['scenes', 'src', 'insp', 'audio', 'st'], right: [] },
    });
    expect(visibleZones(none, true).bottom).toEqual(['scenes', 'pair', 'st']);
    // Closed, nothing steps aside.
    expect(visibleZones(first, false).bottom).toEqual(['scenes', 'audio', 'src', 'insp', 'st']);
  });

  it('leaves hidden docks out', () => {
    expect(visibleZones(layoutWith({ hidden: ['insp'] }), false).bottom).toEqual([
      'scenes',
      'src',
      'st',
      'audio',
    ]);
  });
});

describe('DockLayoutService', () => {
  let storage: MemoryStorage;

  function setup(stored?: unknown): DockLayoutService {
    storage = new MemoryStorage();
    if (stored !== undefined) {
      storage.setItem(
        PREFERENCE_KEYS.layout,
        typeof stored === 'string' ? stored : JSON.stringify(stored),
      );
    }
    TestBed.configureTestingModule({
      providers: [{ provide: BROWSER_STORAGE, useValue: () => storage }],
    });
    return TestBed.inject(DockLayoutService);
  }

  function stored(): DockLayout {
    return JSON.parse(storage.getItem(PREFERENCE_KEYS.layout) ?? 'null') as DockLayout;
  }

  it('starts with the default layout, also for corrupt storage', () => {
    expect(setup().layout()).toEqual(defaultLayout());
    TestBed.resetTestingModule();
    expect(setup('{broken').layout()).toEqual(defaultLayout());
    TestBed.resetTestingModule();
    expect(setup({ v: 1, zones: { left: [], bottom: ['scenes'], right: [] } }).layout()).toEqual(
      defaultLayout(),
    );
  });

  it('restores a layout that was stored before the Audio dock existed, with the dock added', () => {
    const layout = setup({
      v: 1,
      zones: { left: [], bottom: ['scenes', 'src', 'insp'], right: ['st'] },
    });
    expect(layout.zones().right).toEqual(['st']);
    expect(layout.zones().bottom).toEqual(['scenes', 'src', 'insp', 'audio']);
  });

  it('hides a dock from its menu with an undo toast and resets the size of a dock and its zone', () => {
    const layout = setup({
      ...defaultLayout(),
      zones: { left: ['scenes'], bottom: ['src', 'insp', 'st', 'audio'], right: [] },
      weights: { ...defaultLayout().weights, scenes: 3, src: 4 },
      leftW: 400,
      bottomH: 0.5,
    });
    const toasts = TestBed.inject(ToastService);
    layout.hideDock('st');
    expect(layout.isShown('st')).toBe(false);
    expect(toasts.current()?.message).toBe('Devices is hidden');
    toasts.runAction();
    expect(layout.isShown('st')).toBe(true);

    layout.resetDockSize('scenes');
    expect(stored().weights.scenes).toBe(defaultLayout().weights.scenes);
    expect(stored().leftW).toBe(defaultLayout().leftW);
    expect(stored().bottomH).toBe(0.5);
    layout.resetDockSize('src');
    expect(stored().weights.src).toBe(defaultLayout().weights.src);
    expect(stored().bottomH).toBeNull();
  });

  it('restores a valid stored layout', () => {
    const layout = setup({
      ...defaultLayout(),
      zones: { left: [], bottom: ['scenes', 'src', 'insp', 'audio'], right: ['st'] },
    });
    expect(layout.zones().right).toEqual(['st']);
    expect(layout.hasSideDocks()).toBe(true);
    expect(layout.rightEdgeDocks()).toEqual(['st']);
    expect(layout.leftEdgeDocks()).toEqual(['scenes']);
  });

  it('moves a dock, persists and offers "Undo" for that move only', () => {
    const layout = setup();
    const toasts = TestBed.inject(ToastService);
    layout.setShown('audio', false);
    expect(layout.moveDock('st', 'right', 0)).toBe(true);
    expect(stored().zones.right).toEqual(['st']);
    expect(toasts.current()).toMatchObject({
      message: 'Devices is docked on the right',
      action: { label: 'Undo' },
      kind: 'success',
    });
    toasts.runAction();
    expect(layout.layout().zones).toEqual(defaultLayout().zones);
    // The undo puts the docks back; the hidden Audio dock stays hidden.
    expect(layout.isShown('audio')).toBe(false);
    expect(stored().zones).toEqual(defaultLayout().zones);
    expect(toasts.current()?.message).toBe('Move of Devices undone');
  });

  it('resets the layout and brings it back with "Undo"', () => {
    const layout = setup();
    const toasts = TestBed.inject(ToastService);
    layout.moveDock('scenes', 'left', 0);
    layout.setShown('audio', false);
    const custom = layout.layout();
    layout.resetLayout();
    expect(layout.layout()).toEqual(defaultLayout());
    expect(stored()).toEqual(defaultLayout());
    expect(toasts.current()).toMatchObject({
      message: 'Layout reset',
      action: { label: 'Undo' },
    });
    toasts.runAction();
    expect(layout.layout()).toEqual(custom);
    expect(stored()).toEqual(custom);
  });

  it('moves docks with the grip keys', () => {
    const layout = setup();
    expect(layout.moveDockBy('scenes', -1)).toBe(true);
    expect(layout.zones().left).toEqual(['scenes']);
    expect(layout.moveDockBy('scenes', -1)).toBe(false);
  });

  it('hides and shows docks', () => {
    const layout = setup();
    layout.setShown('src', false);
    expect(layout.isShown('src')).toBe(false);
    expect(layout.zones().bottom).toEqual(['scenes', 'insp', 'st', 'audio']);
    expect(stored().hidden).toEqual(['src']);
    layout.setShown('src', true);
    expect(layout.zones().bottom).toEqual(['scenes', 'src', 'insp', 'st', 'audio']);
  });

  it('resizes and resets, persisting on save', () => {
    const layout = setup();
    layout.setWeights('scenes', 2, 'src', 0.01);
    expect(layout.layout().weights.scenes).toBe(2);
    expect(layout.layout().weights.src).toBe(0.05);
    expect(storage.getItem(PREFERENCE_KEYS.layout)).toBeNull();
    layout.save();
    expect(stored().weights.scenes).toBe(2);
    layout.resetWeights('scenes', 'src');
    expect(stored().weights).toEqual(defaultLayout().weights);
    layout.setSideWidth('left', 100);
    expect(layout.layout().leftW).toBe(220);
    layout.setSplit(0.95);
    expect(layout.split()).toBe(0.7);
    layout.resetSplit();
    expect(layout.split()).toBe(0.5);
    layout.setBottomHeight(0.4);
    expect(layout.layout().bottomH).toBe(0.4);
    layout.resetBottomHeight();
    expect(stored().bottomH).toBeNull();
  });

  it('opens the pairing dock and closes it with Escape', () => {
    const layout = setup();
    layout.togglePairing();
    expect(layout.pairingOpen()).toBe(true);
    expect(layout.pairingTab()).toBe('laptop');
    expect(layout.zones().bottom).toEqual(['scenes', 'pair', 'st']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(layout.pairingOpen()).toBe(false);
  });

  it('moves the monitor split through its splitter behaviour', () => {
    const layout = setup();
    const behavior = layout.monitorSplitBehavior(() => 1000);
    const drag = behavior.begin();
    drag?.move(100, 0);
    expect(layout.split()).toBeCloseTo(0.6);
    drag?.end();
    expect(stored().split).toBeCloseTo(0.6);
    behavior.reset();
    expect(layout.split()).toBe(0.5);
  });
});
