import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { canvasDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  productionFixture,
  sceneFixture,
  snapshotFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { GeneralPageComponent } from './general-page.component';

const BASE = `/api/productions/${PRODUCTION_ID}`;
const CANVAS_URL = `${BASE}/canvas`;

describe('GeneralPageComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<GeneralPageComponent>;
  let element: HTMLElement;

  async function setup(snapshot = snapshotFixture()): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshot);
    fixture = TestBed.createComponent(GeneralPageComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function text(node: Element | null | undefined = element): string {
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (entry) => text(entry) === label,
    );
    if (!found) {
      throw new Error(`no button "${label}"`);
    }
    return found;
  }

  async function click(label: string): Promise<void> {
    button(label).click();
    await render();
  }

  function pressed(): string[] {
    return Array.from(element.querySelectorAll('.c-seg button[aria-pressed="true"]')).map((node) =>
      text(node),
    );
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  afterEach(() => harness?.http.verify());

  describe('name', () => {
    it('shows the name with the scope line of the production', async () => {
      await setup(snapshotFixture({ production: productionFixture({ name: 'Webinar' }) }));
      expect(text(element.querySelector('h1'))).toBe('General');
      expect(text(element.querySelector('.c-page__lead'))).toBe(
        'Applies to the production “Webinar”.',
      );
      expect(text(element.querySelector('[data-testid="production-name"]'))).toBe('Webinar');
    });

    it('renames in place and announces the new name', async () => {
      await setup();
      await click('Rename');
      const input = element.querySelector<HTMLInputElement>('#production-name')!;
      type(input, '  Town hall ');
      await click('Save name');

      const request = harness.http.expectOne(BASE);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({
        name: 'Town hall',
        standbySlate: null,
        endSlate: null,
      });
      request.flush(productionFixture({ name: 'Town hall' }));
      await render();
      expect(TestBed.inject(ToastService).current()?.message).toBe(
        'Production is now called “Town hall”',
      );
      expect(element.querySelector('#production-name')).toBeNull();
    });

    it('explains an empty name on blur and sends nothing', async () => {
      await setup();
      await click('Rename');
      const input = element.querySelector<HTMLInputElement>('#production-name')!;
      type(input, '   ');
      input.dispatchEvent(new Event('blur'));
      await render();
      expect(text(element.querySelector('.c-field-error'))).toBe(
        'Enter a name of 1 to 80 characters.',
      );
      await click('Save name');
      harness.http.expectNone(BASE);
    });

    it('goes back without a request on Cancel or an unchanged name', async () => {
      await setup();
      await click('Rename');
      await click('Cancel');
      expect(element.querySelector('#production-name')).toBeNull();
      await click('Rename');
      await click('Save name');
      harness.http.expectNone(BASE);
      expect(element.querySelector('#production-name')).toBeNull();
    });
  });

  describe('format and resolution', () => {
    it('shows the format of the production with its name and canvas size', async () => {
      await setup(
        snapshotFixture({
          production: productionFixture({ canvas: canvasDto('portrait', 'p720') }),
        }),
      );
      expect(pressed()).toEqual(['9:16', '720p']);
      expect(text(element.querySelector('.c-canvas__name'))).toBe(
        'Portrait, for phones and social media',
      );
      expect(text(element.querySelector('.c-canvas__size'))).toBe('Canvas 720 × 1280');
    });

    it('offers all four formats and both resolutions in order', async () => {
      await setup();
      const groups = Array.from(element.querySelectorAll('.c-seg')).map((group) =>
        Array.from(group.querySelectorAll('button')).map((node) => text(node)),
      );
      expect(groups).toEqual([
        ['16:9', '9:16', '1:1', '4:3'],
        ['720p', '1080p'],
      ]);
      expect(text()).toContain('The output page scales it to the window it runs in');
    });

    it('keeps "Save format" off until the choice differs and says why', async () => {
      await setup();
      expect(button('Save format').disabled).toBe(true);
      expect(text(element.querySelector('.c-form-actions__state'))).toBe('No changes');
      await click('720p');
      expect(button('Save format').disabled).toBe(false);
      expect(text(element.querySelector('.c-form-actions__state'))).toBe('Unsaved changes');
      await click('Discard changes');
      expect(pressed()).toEqual(['16:9', '1080p']);
      expect(button('Save format').disabled).toBe(true);
    });

    it('sends another resolution without a question and announces the new size', async () => {
      await setup();
      await click('720p');
      expect(text()).toContain('every element is scaled in proportion');
      await click('Save format');

      const request = harness.http.expectOne(CANVAS_URL);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ format: 'widescreen', resolution: 'p720' });
      request.flush(productionFixture({ canvas: canvasDto('widescreen', 'p720') }));
      await render();
      expect(element.querySelector('sf-confirm-box')).toBeNull();
      expect(TestBed.inject(ToastService).current()?.message).toBe(
        'Output is now 1280 × 720 (16:9)',
      );
    });

    it('asks first for another format when scenes have elements, naming the cleared history first', async () => {
      await setup();
      await click('9:16');
      await click('Save format');

      const box = element.querySelector('sf-confirm-box');
      expect(text(box)).toMatch(/^The undo history of the scenes is cleared/);
      expect(text(box)).toContain('the elements of 2 scenes are scaled to fit the new canvas');
      harness.http.expectNone(CANVAS_URL);

      await click('Change format');
      const request = harness.http.expectOne(CANVAS_URL);
      expect(request.request.body).toEqual({ format: 'portrait', resolution: 'p1080' });
      request.flush(productionFixture({ canvas: canvasDto('portrait', 'p1080') }));
      await render();
      expect(element.querySelector('sf-confirm-box')).toBeNull();
    });

    it('sends nothing when the question is cancelled, and drops it when the choice changes', async () => {
      await setup();
      await click('1:1');
      await click('Save format');
      await click('Cancel');
      expect(element.querySelector('sf-confirm-box')).toBeNull();
      expect(pressed()).toEqual(['1:1', '1080p']);
      await click('Save format');
      await click('4:3');
      expect(element.querySelector('sf-confirm-box')).toBeNull();
      harness.http.expectNone(CANVAS_URL);
    });

    it('names one scene in the singular', async () => {
      await setup(
        snapshotFixture({
          scenes: [snapshotFixture().scenes[0], sceneFixture('scn_empty', 'Break', 1)],
        }),
      );
      await click('4:3');
      await click('Save format');
      expect(text(element.querySelector('sf-confirm-box'))).toContain(
        'the elements of 1 scene are scaled',
      );
    });

    it('does not ask when no scene has elements', async () => {
      await setup(snapshotFixture({ scenes: [sceneFixture('scn_a', 'Welcome', 0)] }));
      await click('9:16');
      await click('Save format');
      expect(element.querySelector('sf-confirm-box')).toBeNull();
      harness.http
        .expectOne(CANVAS_URL)
        .flush(productionFixture({ canvas: canvasDto('portrait', 'p1080') }));
    });

    it('keeps the choice when the production changes for another reason', async () => {
      await setup();
      await click('9:16');
      harness.emitEvent({
        type: 'productionChanged',
        production: productionFixture({ name: 'Webinar renamed' }),
      });
      await render();
      expect(pressed()).toEqual(['9:16', '1080p']);
    });

    it('locks the choice while the broadcast is live and says so in neutral words', async () => {
      await setup(snapshotFixture({ production: productionFixture({ broadcast: 'live' }) }));
      const status = element.querySelector('[role="status"]');
      expect(text(status)).toContain('locked while the broadcast is live');
      expect(status?.classList.contains('c-field-error')).toBe(false);
      const choices = Array.from(element.querySelectorAll<HTMLButtonElement>('.c-seg button'));
      expect(choices.every((choice) => choice.disabled)).toBe(true);
      expect(element.querySelector('button[type="submit"]')).toBeNull();
      element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
      await render();
      harness.http.expectNone(CANVAS_URL);
    });

    it('shows the reason when the server refuses and keeps the choice', async () => {
      await setup(snapshotFixture({ scenes: [sceneFixture('scn_a', 'Welcome', 0)] }));
      await click('4:3');
      await click('Save format');
      harness.http
        .expectOne(CANVAS_URL)
        .flush(
          { status: 409, code: 'broadcast_live', title: 'Conflict' },
          { status: 409, statusText: 'Conflict' },
        );
      await render();
      expect(TestBed.inject(ToastService).current()?.message).toBe(
        'That is not possible while the broadcast is live. End the broadcast first.',
      );
      expect(pressed()).toEqual(['4:3', '1080p']);
    });
  });
});
