import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  productionFixture,
  snapshotFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { EditorService } from '../../stage/editor.service';
import { SourcesDockComponent } from './sources-dock.component';

const SCENE_B = `/api/productions/${PRODUCTION_ID}/scenes/scn_b`;

describe('SourcesDockComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<SourcesDockComponent>;
  let element: HTMLElement;

  async function setup(programSceneId = 'scn_b'): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ programSceneId }),
        sources: [
          sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', {
            label: 'Handy Bühne links',
            status: 'reconnecting',
            statusSince: new Date(Date.now() - 8000).toISOString(),
          }),
          sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', { label: 'Laptop Lea · Folien' }),
          sourceFixture('dev_cccccccccccccccc', 'camera', 'K2', { label: 'Handy Totale' }),
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

  function rows(): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>('.c-src'));
  }

  function text(node: Element | null | undefined): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  afterEach(() => harness.http.verify());

  it('lists the items front to back with code, state, timer and lamp', async () => {
    await setup();
    const [front, back] = rows();
    expect(rows()).toHaveLength(2);
    expect(text(front.querySelector('.c-code'))).toBe('K1');
    expect(text(front.querySelector('.c-src__name'))).toBe('Handy Bühne links');
    expect(text(front.querySelector('.c-state--warn'))).toBe('verbindet neu');
    expect(text(front.querySelector('.c-src__state .u-mono'))).toMatch(/^00:0[89]$/);
    expect(front.querySelector('.c-lamp')?.className).toContain('is-warn');
    expect(text(back.querySelector('.c-code'))).toBe('S1');
    expect(back.querySelector('.c-src__state')).toBeNull();
    expect(text(element.querySelector('.c-src-dock__hint'))).toBe(
      'Ein Element im Program-Monitor anklicken, dann ziehen oder an den Ecken skalieren. ' +
        'Ohne Studio-Modus wirkt jede Änderung sofort live.',
    );
    const eye = front.querySelector<HTMLButtonElement>('.c-ibtn');
    expect(eye?.getAttribute('aria-label')).toBe('Ausblenden: Handy Bühne links');
    expect(eye?.getAttribute('aria-pressed')).toBe('true');
  });

  it('selects a row for the monitor and the inspector', async () => {
    await setup();
    rows()[1].querySelector<HTMLButtonElement>('.c-src__select')?.click();
    await render();
    expect(TestBed.inject(EditorService).selectedItemId()).toBe('itm_b1');
    expect(rows()[1].className).toContain('is-sel');
    expect(element.querySelector('.c-src-dock__hint')).toBeNull();
  });

  it('hides and locks items through the editor', async () => {
    await setup();
    const [front] = rows();
    front.querySelector<HTMLButtonElement>('.c-ibtn')?.click();
    const hide = harness.http.expectOne(`${SCENE_B}/items/itm_b2`);
    expect(hide.request.body.hidden).toBe(true);
    await render();
    expect(rows()[0].className).toContain('is-hidden');
    expect(rows()[0].querySelector('.c-ibtn')?.getAttribute('aria-label')).toBe(
      'Einblenden: Handy Bühne links',
    );
    hide.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await render();
    const lock = rows()[0].querySelectorAll<HTMLButtonElement>('.c-ibtn')[1];
    expect(lock.getAttribute('aria-label')).toBe('Sperren: Handy Bühne links');
    lock.click();
    const locked = harness.http.expectOne(`${SCENE_B}/items/itm_b2`);
    expect(locked.request.body.locked).toBe(true);
    locked.flush({ ...harness.store.sceneById('scn_b'), version: 3 });
    await render();
  });

  it('shows the empty state of an empty scene', async () => {
    await setup('scn_c');
    expect(text(element.querySelector('.c-empty strong'))).toBe('Diese Szene ist leer.');
    expect(text(element.querySelector('.c-empty'))).toContain(
      'Füge eine Quelle hinzu oder wende eine Vorlage an.',
    );
  });

  it('adds a source from the «+ Quelle» menu, grouped by kind', async () => {
    await setup();
    const trigger = Array.from(element.querySelectorAll<HTMLButtonElement>('.c-btn')).find(
      (button) => text(button) === 'Quelle',
    );
    trigger?.click();
    await render();
    const menu = element.querySelector('[role="menu"]');
    expect(text(menu?.querySelector('.c-pop-h'))).toBe('Zu «Präsentation» hinzufügen');
    const groups = Array.from(menu?.querySelectorAll('.c-add-pop__label') ?? []).map(text);
    expect(groups).toEqual(['Kameras']);
    const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    expect(items.map(text)).toEqual(['K2Handy Totale', 'Bild oder Video hochladen …']);
    items[0].click();
    const add = harness.http.expectOne(`${SCENE_B}/items`);
    expect(add.request.body.items.at(-1)).toMatchObject({
      source: 'dev_cccccccccccccccc/camera',
      x: 1240,
      y: 680,
      w: 600,
      h: 338,
    });
    add.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    await render();
    expect(element.querySelector('[role="menu"]')).toBeNull();
  });
});
