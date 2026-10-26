import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { SourcePlaceholderDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  itemFixture,
  placeholderFixture,
  sceneFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { PlaceholderListComponent } from './placeholder-list.component';

const BASE = `/api/productions/${PRODUCTION_ID}/placeholders`;
const K7 = placeholderFixture('K7', 'Stage phone');
const S4 = placeholderFixture('S4', null);

describe('PlaceholderListComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<PlaceholderListComponent>;
  let element: HTMLElement;

  async function setup(
    placeholders: SourcePlaceholderDto[] = [K7, S4],
    withSources = true,
  ): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      dockSnapshot({
        placeholders,
        scenes: [
          sceneFixture('scn_a', 'Welcome', 0, [itemFixture('itm_a1', K7.sourceId)]),
          sceneFixture('scn_b', 'Presentation', 1, [
            itemFixture('itm_b1', K7.sourceId),
            itemFixture('itm_b2', K7.sourceId, { x: 700 }),
          ]),
        ],
        sources: withSources
          ? [
              sourceFixture('dev_aaaaaaaaaaaaaaaa', 'camera', 'K1', { label: 'Phone one' }),
              sourceFixture('dev_bbbbbbbbbbbbbbbb', 'screen-1', 'S1', { label: 'Laptop' }),
              sourceFixture('dev_cccccccccccccccc', 'camera', 'K2', { status: 'blocked' }),
            ]
          : [],
      }),
    );
    fixture = TestBed.createComponent(PlaceholderListComponent);
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

  function assignButton(code: string): HTMLButtonElement {
    return element.querySelector<HTMLButtonElement>(`[data-code="${code}"] .c-ph__row .c-btn`)!;
  }

  afterEach(() => harness.http.verify());

  it('lists the missing sources with code, name and where they are used', async () => {
    await setup();
    expect(text(element.querySelector('.c-ph__title'))).toBe('Missing sources');
    const rows = Array.from(element.querySelectorAll('.c-ph__item'));
    expect(rows).toHaveLength(2);
    expect(text(rows[0].querySelector('.c-code'))).toBe('K7');
    expect(text(rows[0].querySelector('.c-ph__name'))).toBe('Stage phone');
    expect(text(rows[0].querySelector('.c-ph__used'))).toBe('in 2 scenes');
    expect(text(rows[1].querySelector('.c-ph__name'))).toBe('removed source');
    expect(text(rows[1].querySelector('.c-ph__used'))).toBe('in no scene');
    expect(assignButton('K7').getAttribute('aria-label')).toBe('Assign K7 · Stage phone');
  });

  it('shows nothing in a production without placeholders', async () => {
    await setup([]);
    expect(element.querySelector('.c-ph')).toBeNull();
  });

  it('opens the sources to choose from, grouped, without blocked ones', async () => {
    await setup();
    assignButton('K7').click();
    await render();
    expect(assignButton('K7').getAttribute('aria-expanded')).toBe('true');
    const picker = element.querySelector('.c-ph__picker')!;
    expect(text(picker.querySelector('.c-ph__picker-h'))).toBe('Show K7 · Stage phone as');
    expect(Array.from(picker.querySelectorAll('.c-ph__group-l')).map(text)).toEqual([
      'Cameras',
      'Screens',
    ]);
    expect(Array.from(picker.querySelectorAll('.c-menu-item .c-code')).map(text)).toEqual([
      'K1',
      'S1',
    ]);
    // A second click on the button closes the list again.
    assignButton('K7').click();
    await render();
    expect(element.querySelector('.c-ph__picker')).toBeNull();
  });

  it('assigns the chosen source with one click and closes the list when the server agrees', async () => {
    await setup();
    assignButton('K7').click();
    await render();
    element
      .querySelector<HTMLButtonElement>('[data-source="dev_aaaaaaaaaaaaaaaa/camera"]')!
      .click();
    const request = harness.http.expectOne(`${BASE}/${K7.id}/assignment`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ sourceId: 'dev_aaaaaaaaaaaaaaaa/camera' });
    request.flush({ scenes: 2, items: 3 });
    await render();
    expect(element.querySelector('.c-ph__picker')).toBeNull();
    expect(TestBed.inject(ToastService).current()?.message).toBe(
      'The scenes now show K1 Phone one in place of K7 · Stage phone.',
    );
  });

  it('keeps the list open when the assignment fails', async () => {
    await setup();
    assignButton('K7').click();
    await render();
    element
      .querySelector<HTMLButtonElement>('[data-source="dev_bbbbbbbbbbbbbbbb/screen-1"]')!
      .click();
    harness.http
      .expectOne(`${BASE}/${K7.id}/assignment`)
      .flush({ status: 404, code: 'not_found' }, { status: 404, statusText: 'Not Found' });
    await render();
    expect(element.querySelector('.c-ph__picker')).not.toBeNull();
  });

  it('says so when there is nothing to assign yet', async () => {
    await setup([K7], false);
    assignButton('K7').click();
    await render();
    expect(text(element.querySelector('.c-ph__picker .c-pop-note'))).toBe(
      'There is no camera, screen or medium to assign yet. Pair a device first.',
    );
  });

  it('removes a placeholder from all scenes only after the confirmation', async () => {
    await setup();
    assignButton('K7').click();
    await render();
    element.querySelector<HTMLButtonElement>('.c-ph__remove')!.click();
    await render();
    harness.http.expectNone(`${BASE}/${K7.id}`);
    expect(text(element.querySelector('.c-confirm span'))).toBe(
      'The 3 elements that show K7 · Stage phone are removed from their scenes.',
    );
    element.querySelector<HTMLButtonElement>('.c-btn--danger-fill')!.click();
    const request = harness.http.expectOne(`${BASE}/${K7.id}`);
    expect(request.request.method).toBe('DELETE');
    request.flush({ scenes: 2, items: 3 });
    await render();
    expect(element.querySelector('.c-ph__picker')).toBeNull();
    expect(TestBed.inject(ToastService).current()?.message).toBe(
      'K7 · Stage phone removed from the scenes.',
    );
  });

  it('cancelling the confirmation sends nothing', async () => {
    await setup();
    assignButton('K7').click();
    await render();
    element.querySelector<HTMLButtonElement>('.c-ph__remove')!.click();
    await render();
    element.querySelector<HTMLButtonElement>('[data-cancel]')!.click();
    await render();
    expect(element.querySelector('.c-confirm')).toBeNull();
    expect(element.querySelector('.c-ph__remove')).not.toBeNull();
  });

  it('follows the store: the row disappears when the placeholder is removed', async () => {
    await setup();
    harness.emitEvent({ type: 'placeholderRemoved', placeholderId: K7.id });
    await harness.settle();
    await render();
    expect(element.querySelectorAll('.c-ph__item')).toHaveLength(1);
  });
});
