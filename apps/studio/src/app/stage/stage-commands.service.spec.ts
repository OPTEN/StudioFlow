import { TestBed } from '@angular/core/testing';
import type { SceneDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, snapshotFixture } from '../../testing/fixtures';
import {
  MemoryStorage,
  startStore,
  studioTestProviders,
  type StoreHarness,
} from '../../testing/store-harness';
import type { ContextMenuEntry, ContextMenuItem } from '../core/ui/context-menu';
import { PREFERENCE_KEYS } from '../core/ui/preferences.service';
import { DockLayoutService } from '../shell/workspace/dock-layout.service';
import { EditorService } from './editor.service';
import { SAFE_AREA_KEY, StageCommandsService } from './stage-commands.service';

const SCENE_A = `/api/productions/${PRODUCTION_ID}/scenes/scn_a`;

function items(entries: readonly ContextMenuEntry[]): ContextMenuItem[] {
  return entries.filter((entry): entry is ContextMenuItem => entry !== 'separator');
}

function entry(entries: readonly ContextMenuEntry[], label: string): ContextMenuItem {
  const found = items(entries).find((item) => item.label === label);
  if (!found) {
    throw new Error(`no entry ${label}`);
  }
  return found;
}

describe('StageCommandsService', () => {
  let hub: FakeStudioHub;
  let harness: StoreHarness;
  let storage: MemoryStorage;
  let commands: StageCommandsService;
  let editor: EditorService;

  async function setup(options: { studio?: boolean; preview?: string | null } = {}): Promise<void> {
    hub = new FakeStudioHub();
    storage = new MemoryStorage();
    if (options.studio) {
      storage.setItem(PREFERENCE_KEYS.studioMode, '1');
    }
    TestBed.configureTestingModule({ providers: studioTestProviders(hub, storage) });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ previewSceneId: options.preview ?? null }),
      }),
    );
    commands = TestBed.inject(StageCommandsService);
    editor = TestBed.inject(EditorService);
    await flushMicrotasks();
  }

  afterEach(() => harness?.http.verify());

  it('offers the item commands with the right states and selects the item', async () => {
    await setup();
    const menu = commands.itemMenu('itm_a1');
    expect(editor.selectedItemId()).toBe('itm_a1');
    // The only item: no layer moves.
    expect(entry(menu, 'Bring forward').disabled).toBe(true);
    expect(entry(menu, 'Send to back').disabled).toBe(true);
    expect(entry(menu, 'Fill').checked).toBe(true);
    expect(entry(menu, 'Remove from scene')).toMatchObject({ danger: true, shortcut: 'Del' });
    expect(entry(menu, 'Lock').disabled).toBeFalsy();
    expect(commands.itemMenu('nope')).toEqual([]);
  });

  it('“Full screen” covers the canvas with square corners', async () => {
    await setup();
    entry(commands.itemMenu('itm_a1'), 'Full screen').run();
    expect(editor.itemById('itm_a1')).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080, radius: 0 });
    const request = harness.http.expectOne(`${SCENE_A}/items/itm_a1`);
    request.flush({ ...(harness.store.sceneById('scn_a') as SceneDto), version: 2 });
    await flushMicrotasks();
  });

  it('“Properties…” selects the item and shows the Properties dock', async () => {
    await setup();
    const layout = TestBed.inject(DockLayoutService);
    layout.setShown('insp', false);
    commands.showProperties('itm_a1');
    expect(editor.selectedItemId()).toBe('itm_a1');
    expect(layout.isShown('insp')).toBe(true);
  });

  it('disables the changing commands while the scene is live in Studio Mode', async () => {
    await setup({ studio: true, preview: 'scn_a' });
    const menu = commands.itemMenu('itm_a1');
    expect(entry(menu, 'Full screen').disabled).toBe(true);
    expect(entry(menu, 'Remove from scene').disabled).toBe(true);
    expect(entry(menu, 'Lock').disabled).toBeFalsy();
  });

  it('builds the monitor menus: Take and loading on the Preview, Studio Mode on the Program', async () => {
    await setup({ studio: true, preview: 'scn_b' });
    const preview = commands.monitorMenu('preview', harness.store.sceneById('scn_b') ?? null);
    expect(items(preview).map((item) => item.label)).toEqual([
      'Take',
      'Send Program to Preview',
      'Load next scene',
      'Show safe area',
      'Copy scene name',
    ]);
    expect(entry(preview, 'Take')).toMatchObject({ shortcut: 'Space', disabled: false });
    expect(entry(preview, 'Load next scene').disabled, 'the next scene is already there').toBe(
      true,
    );
    const program = commands.monitorMenu('program', null);
    expect(items(program)[0].label).toBe('Turn off Studio Mode');
    expect(entry(program, 'Copy scene name').disabled).toBe(true);
  });

  it('keeps “Show safe area” in this browser', async () => {
    await setup();
    expect(commands.showSafeArea()).toBe(false);
    entry(commands.monitorMenu('program', null), 'Show safe area').run();
    expect(commands.showSafeArea()).toBe(true);
    expect(entry(commands.monitorMenu('program', null), 'Show safe area').checked).toBe(true);
    expect(storage.getItem(SAFE_AREA_KEY)).toBe('1');
    commands.toggleSafeArea();
    expect(commands.showSafeArea()).toBe(false);
  });
});
