import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  itemFixture,
  productionFixture,
  sceneFixture,
  textSourceFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { EditorService } from '../../stage/editor.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { PropertiesDockComponent } from './properties-dock.component';

const BASE = `/api/productions/${PRODUCTION_ID}`;
const TEXT_ID = 'txt_aaaaaaaaaaaaaaaa';
const OTHER_TEXT_ID = 'txt_bbbbbbbbbbbbbbbb';

describe('text editor in the Properties dock', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<PropertiesDockComponent>;
  let element: HTMLElement;
  let editor: EditorService;

  async function setup(
    options: { hidden?: boolean; style?: 'lowerThird' | 'title' } = {},
  ): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      dockSnapshot({
        production: productionFixture({ programSceneId: 'scn_b' }),
        scenes: [
          sceneFixture('scn_a', 'Welcome', 0, [itemFixture('itm_a1', TEXT_ID)]),
          sceneFixture('scn_b', 'Presentation', 1, [
            itemFixture('itm_t1', TEXT_ID, {
              hidden: options.hidden ?? true,
              x: 80,
              y: 820,
              w: 960,
              h: 180,
              radius: 0,
            }),
            itemFixture('itm_t2', OTHER_TEXT_ID),
          ]),
        ],
        sources: [
          textSourceFixture(TEXT_ID, 'T1', { style: options.style ?? 'lowerThird' }),
          textSourceFixture(OTHER_TEXT_ID, 'T2', { line1: 'Leo Lang', line2: null }),
        ],
      }),
    );
    editor = TestBed.inject(EditorService);
    fixture = TestBed.createComponent(PropertiesDockComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
    editor.select('itm_t1');
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

  function field(id: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (entry) => text(entry) === label,
    );
  }

  function previewText(): string {
    return text(element.querySelector('sf-text-preview .sf-r-text'));
  }

  afterEach(() => {
    harness.http.verify();
    vi.useRealTimers();
  });

  it('shows the editor of a hidden text with its content, the preview and the geometry only', async () => {
    await setup();

    expect(element.querySelector('.c-insp-head')?.getAttribute('data-view')).toBe('item');
    expect(text(element.querySelector('.c-insp-head .c-code'))).toBe('T1');
    expect(text(element.querySelector('.c-insp-head__name'))).toBe('Mia Meier');
    expect(field('sf-text-line1').value).toBe('Mia Meier');
    expect(field('sf-text-line2').value).toBe('Moderator');
    // The counter appears only near the limit.
    expect(element.querySelector('#sf-text-line1-count')).toBeNull();
    expect(previewText()).toBe('Mia MeierModerator');
    expect(element.querySelector('#sf-insp-x')).not.toBeNull();
    // No crop, fit, border or fallback for a text.
    expect(element.querySelector('#sf-insp-fit')).toBeNull();
    expect(element.querySelector('#sf-insp-crop')).toBeNull();
    expect(element.querySelector('#sf-insp-fallback')).toBeNull();
    // The output switch comes first; the text is hidden, so it is off and not on air.
    const toggle = element.querySelector<HTMLInputElement>('[data-text-toggle]') as HTMLInputElement;
    expect(element.querySelector('.c-text input')).toBe(toggle);
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(element.querySelector('.c-text__output .c-tag--pgm')).toBeNull();
    // One footer with both destructive actions.
    expect(
      Array.from(element.querySelectorAll('.c-insp__danger button')).map((entry) => text(entry)),
    ).toEqual(['Remove from scene', 'Delete text…']);
  });

  it('shows the lower third without an alignment and the title with one', async () => {
    await setup();
    expect(element.querySelector('#sf-text-align')).toBeNull();

    TestBed.resetTestingModule();
    await setup({ style: 'title' });

    expect(text(element.querySelector('#sf-text-align'))).toBe('Alignment');
    expect(button('Centre')).toBeDefined();
  });

  it('draws what is typed in the preview at once and sends it after a short pause', async () => {
    await setup();
    vi.useFakeTimers();

    type(field('sf-text-line1'), 'Mia Meier-Lang');
    fixture.detectChanges();

    expect(previewText()).toBe('Mia Meier-LangModerator');
    harness.http.expectNone(`${BASE}/texts/${TEXT_ID}`);
    type(field('sf-text-line2'), 'Gast');
    await vi.advanceTimersByTimeAsync(200);
    harness.http.expectNone(`${BASE}/texts/${TEXT_ID}`);
    await vi.advanceTimersByTimeAsync(100);
    const update = harness.http.expectOne(`${BASE}/texts/${TEXT_ID}`);
    expect(update.request.method).toBe('PUT');
    expect(update.request.body).toEqual({
      line1: 'Mia Meier-Lang',
      line2: 'Gast',
      style: 'lowerThird',
      align: 'left',
    });
    update.flush({});
  });

  it('sends the typed text when the field is left', async () => {
    await setup();

    type(field('sf-text-line1'), 'Ada');
    field('sf-text-line1').dispatchEvent(new Event('blur'));

    const update = harness.http.expectOne(`${BASE}/texts/${TEXT_ID}`);
    expect(update.request.body.line1).toBe('Ada');
    update.flush({});
    await render();
  });

  it('sends only one request at a time and then the newest state', async () => {
    await setup();

    type(field('sf-text-line1'), 'A');
    field('sf-text-line1').dispatchEvent(new Event('blur'));
    const first = harness.http.expectOne(`${BASE}/texts/${TEXT_ID}`);
    type(field('sf-text-line1'), 'AB');
    field('sf-text-line1').dispatchEvent(new Event('blur'));
    harness.http.expectNone(`${BASE}/texts/${TEXT_ID}`);
    first.flush({});
    await flushMicrotasks();

    const second = harness.http.expectOne(`${BASE}/texts/${TEXT_ID}`);
    expect(second.request.body.line1).toBe('AB');
    second.flush({});
  });

  it('never sends an empty first line and says why', async () => {
    await setup();

    type(field('sf-text-line1'), '   ');
    field('sf-text-line1').dispatchEvent(new Event('blur'));
    await render();

    harness.http.expectNone(`${BASE}/texts/${TEXT_ID}`);
    expect(text(element.querySelector('#sf-text-line1-error'))).toBe('Enter the first line.');
    expect(field('sf-text-line1').getAttribute('aria-invalid')).toBe('true');
  });

  it('counts emoji once and does not send a line that is too long', async () => {
    await setup();

    type(field('sf-text-line2'), '😀'.repeat(120));
    await render();
    expect(text(element.querySelector('#sf-text-line2-count'))).toBe('120 of 120');
    type(field('sf-text-line2'), '😀'.repeat(121));
    field('sf-text-line2').dispatchEvent(new Event('blur'));
    await render();

    expect(text(element.querySelector('#sf-text-line2-count'))).toBe('121 of 120');
    expect(element.querySelector('#sf-text-line2-count')?.className).toContain('is-over');
    harness.http.expectNone(`${BASE}/texts/${TEXT_ID}`);
  });

  it('changes the style at once and starts the title centred', async () => {
    await setup();

    button('Title')?.click();

    const update = harness.http.expectOne(`${BASE}/texts/${TEXT_ID}`);
    expect(update.request.body).toMatchObject({ style: 'title', align: 'center' });
    update.flush({});
    await render();
    expect(text(element.querySelector('#sf-text-align'))).toBe('Alignment');
  });

  it('keeps the alignment when a title becomes a note', async () => {
    await setup({ style: 'title' });

    button('Right')?.click();
    harness.http.expectOne(`${BASE}/texts/${TEXT_ID}`).flush({});
    await render();
    button('Note')?.click();

    const update = harness.http.expectOne(`${BASE}/texts/${TEXT_ID}`);
    expect(update.request.body).toMatchObject({ style: 'note', align: 'right' });
    update.flush({});
  });

  it('changes the alignment of a title', async () => {
    await setup({ style: 'title' });

    button('Right')?.click();

    const update = harness.http.expectOne(`${BASE}/texts/${TEXT_ID}`);
    expect(update.request.body.align).toBe('right');
    update.flush({});
  });

  it('follows a change of the text from another Regie while nothing is typed', async () => {
    await setup();

    harness.emitEvent({
      type: 'sourceUpserted',
      source: textSourceFixture(TEXT_ID, 'T1', { line1: 'Sam Senn', line2: 'CEO' }),
    });
    await render();

    expect(field('sf-text-line1').value).toBe('Sam Senn');
    expect(field('sf-text-line2').value).toBe('CEO');
    expect(previewText()).toBe('Sam SennCEO');
  });

  it('keeps what is being typed when another change arrives', async () => {
    await setup();

    type(field('sf-text-line1'), 'Typing');
    harness.emitEvent({
      type: 'sourceUpserted',
      source: textSourceFixture(TEXT_ID, 'T1', { line1: 'Elsewhere' }),
    });
    await render();

    expect(field('sf-text-line1').value).toBe('Typing');
    field('sf-text-line1').dispatchEvent(new Event('blur'));
    harness.http.expectOne(`${BASE}/texts/${TEXT_ID}`).flush({});
  });

  it('shows and hides the text with the switch, also while it is live', async () => {
    await setup();
    const toggle = element.querySelector<HTMLInputElement>('[data-text-toggle]') as HTMLInputElement;
    expect(text(toggle.closest('label'))).toContain('Show on the output');
    expect(toggle.checked).toBe(false);

    toggle.click();

    const show = harness.http.expectOne(`${BASE}/scenes/scn_b/items/itm_t1`);
    expect(show.request.body.hidden).toBe(false);
    show.flush({ ...harness.store.sceneById('scn_b'), version: 2 });
    harness.emitEvent({
      type: 'sceneUpserted',
      scene: sceneFixture(
        'scn_b',
        'Presentation',
        1,
        [itemFixture('itm_t1', TEXT_ID, { hidden: false })],
        { version: 2 },
      ),
    });
    await render();
    expect(toggle.checked).toBe(true);
    // Shown in the Program scene: on air.
    expect(text(element.querySelector('.c-text__output .c-tag--pgm'))).toBe('Live');
  });

  it('says in how many scenes a change applies', async () => {
    await setup();

    expect(text(element.querySelector('.c-text'))).toContain('Shown in 2 scenes.');
  });

  it('deletes the text after the confirmation and names the scenes it is removed from', async () => {
    await setup();

    button('Delete text…')?.click();
    await render();
    expect(text(element.querySelector('.c-confirm span'))).toBe(
      'T1 is deleted and removed from 2 scenes.',
    );
    harness.http.expectNone(() => true);
    element.querySelector<HTMLButtonElement>('.c-confirm .c-btn--danger-fill')?.click();

    const remove = harness.http.expectOne(`${BASE}/texts/${TEXT_ID}`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    await render();
  });

  it('disables the editor while the server cannot be reached', async () => {
    await setup();

    harness.hub.setState('reconnecting');
    await render();

    expect(field('sf-text-line1').disabled).toBe(true);
    expect(text(element.querySelector('.c-text'))).toContain('No connection to the server.');
  });
});
