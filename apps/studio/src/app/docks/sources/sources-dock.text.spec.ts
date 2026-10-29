import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  itemFixture,
  productionFixture,
  sceneFixture,
  sourceFixture,
  textSourceFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { EditorService } from '../../stage/editor.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { SourcesDockComponent } from './sources-dock.component';

const BASE = `/api/productions/${PRODUCTION_ID}`;
const SCENE_B = `${BASE}/scenes/scn_b`;

describe('SourcesDockComponent with texts', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<SourcesDockComponent>;
  let element: HTMLElement;

  async function setup(): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      dockSnapshot({
        production: productionFixture({ programSceneId: 'scn_b' }),
        scenes: [
          sceneFixture('scn_b', 'Presentation', 0, [
            itemFixture('itm_cam', 'dev_aaaaaaaaaaaaaaaa/camera'),
            itemFixture('itm_txt', 'txt_aaaaaaaaaaaaaaaa', { hidden: true }),
          ]),
        ],
        sources: [
          sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { label: 'Phone stage left' }),
          textSourceFixture('txt_aaaaaaaaaaaaaaaa', 'T1'),
          textSourceFixture('txt_bbbbbbbbbbbbbbbb', 'T2', { line1: 'Leo Lang', line2: 'Gast' }),
        ],
      }),
    );
    fixture = TestBed.createComponent(SourcesDockComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function rows(): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>('.c-src'));
  }

  async function openMenu(): Promise<HTMLElement> {
    const trigger = element.querySelector<HTMLButtonElement>('button[aria-label="Add source"]');
    trigger?.click();
    await render();
    return element.querySelector('[role="menu"]') as HTMLElement;
  }

  afterEach(() => harness.http.verify());

  it('lists a text with its code, its first line, the text icon and no lamp', async () => {
    await setup();
    const row = rows()[0];

    expect(text(row.querySelector('.c-code'))).toBe('T1');
    expect(text(row.querySelector('.c-src__name'))).toBe('Mia Meier');
    expect(row.className).toContain('is-text');
    expect(row.className).toContain('is-hidden');
    expect(row.querySelector('.c-lamp')).toBeNull();
    expect(row.querySelector('.c-src__state')).toBeNull();
    expect(row.querySelector('.c-ibtn')?.getAttribute('aria-label')).toBe('Show: Mia Meier');
  });

  it('selects a hidden text for the editor, but not a hidden camera', async () => {
    await setup();
    const editor = TestBed.inject(EditorService);

    rows()[0].querySelector<HTMLButtonElement>('.c-src__select')?.click();
    await render();

    expect(editor.selectedItemId()).toBe('itm_txt');
    expect(rows()[0].className).toContain('is-sel');
    expect(rows()[0].querySelector('.c-src__select')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('shows a hidden text with the eye button', async () => {
    await setup();

    rows()[0].querySelector<HTMLButtonElement>('.c-ibtn')?.click();

    const request = harness.http.expectOne(`${SCENE_B}/items/itm_txt`);
    expect(request.request.body.hidden).toBe(false);
    request.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await render();
  });

  it('offers the texts that are not in the scene and the three styles for a new text', async () => {
    await setup();

    const menu = await openMenu();

    const groups = Array.from(menu.querySelectorAll('.c-add-pop__label')).map(text);
    expect(groups).toEqual(['Cameras', 'Texts', 'New text']);
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).map(
      text,
    );
    expect(items).toEqual([
      'K1Phone stage leftIn scene',
      'T1Mia MeierIn scene',
      'T2Leo Lang',
      'Lower third',
      'Title',
      'Note',
      'Upload image or video…',
      'Media library…',
    ]);
    expect(text(menu.querySelector('.c-add-pop__hint'))).toBe(
      'Added hidden, so you can write it first.',
    );
  });

  it('adds an existing text hidden, in the rectangle of its style', async () => {
    await setup();
    const menu = await openMenu();

    Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => text(item) === 'T2Leo Lang')
      ?.click();

    const request = harness.http.expectOne(`${SCENE_B}/items`);
    expect(request.request.body.items.at(-1)).toMatchObject({
      source: 'txt_bbbbbbbbbbbbbbbb',
      x: 80,
      y: 820,
      w: 960,
      h: 180,
      hidden: true,
      radius: 0,
    });
    request.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await render();
  });

  it('creates a new text from the menu and adds it to the scene', async () => {
    await setup();
    const menu = await openMenu();

    Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => text(item) === 'Note')
      ?.click();

    const create = harness.http.expectOne(`${BASE}/texts`);
    expect(create.request.body).toMatchObject({ style: 'note', line1: 'Note' });
    create.flush({
      id: 'txt_cccccccccccccccc',
      code: 'T3',
      line1: 'Note',
      line2: null,
      style: 'note',
      align: 'left',
    });
    await flushMicrotasks();
    const add = harness.http.expectOne(`${SCENE_B}/items`);
    expect(add.request.body.items.at(-1)).toMatchObject({
      source: 'txt_cccccccccccccccc',
      x: 1320,
    });
    add.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await render();
  });
});
