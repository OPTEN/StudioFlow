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
import { PopoverService } from '../../core/ui/popover.directive';
import { PRODUCTION_POPOVER, ProductionMenuComponent } from './production-menu.component';

const CANVAS_URL = `/api/productions/${PRODUCTION_ID}/canvas`;

describe('ProductionMenuComponent: format and resolution', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<ProductionMenuComponent>;
  let element: HTMLElement;

  async function setup(snapshot = snapshotFixture()): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshot);
    fixture = TestBed.createComponent(ProductionMenuComponent);
    element = fixture.nativeElement as HTMLElement;
    TestBed.inject(PopoverService).open(PRODUCTION_POPOVER);
    await render();
    harness.http.expectOne('/api/productions').flush([]);
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
    return Array.from(element.querySelectorAll('.c-seg button[aria-pressed="true"]')).map(text);
  }

  async function openCanvas(): Promise<void> {
    await click('Format and resolution…');
  }

  async function submit(): Promise<void> {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await render();
  }

  afterEach(() => harness?.http.verify());

  describe('in the menu', () => {
    it('offers "Format and resolution…" and opens the picker with the format of the production', async () => {
      await setup(
        snapshotFixture({
          production: productionFixture({ canvas: canvasDto('portrait', 'p720') }),
        }),
      );

      await openCanvas();

      expect(text(element.querySelector('.c-pop-h'))).toBe('Format and resolution');
      expect(pressed()).toEqual(['9:16', '720p']);
      expect(text(element.querySelector('.c-canvas__name'))).toBe(
        'Portrait, for phones and social media',
      );
      expect(text(element.querySelector('.c-canvas__size'))).toBe('Canvas 720 × 1280');
    });

    it('offers all four formats and both resolutions in order', async () => {
      await setup();

      await openCanvas();

      const groups = Array.from(element.querySelectorAll('.c-seg')).map((group) =>
        Array.from(group.querySelectorAll('button')).map(text),
      );
      expect(groups).toEqual([
        ['16:9', '9:16', '1:1', '4:3'],
        ['720p', '1080p'],
      ]);
    });

    it('shows the size of the choice and the note about the proxy window', async () => {
      await setup();
      await openCanvas();

      await click('4:3');

      expect(text(element.querySelector('.c-canvas__size'))).toBe('Canvas 1440 × 1080');
      expect(text(element)).toContain('not the pixels that arrive at the proxy');
    });

    it('keeps Save off until the choice differs from the production', async () => {
      await setup();
      await openCanvas();
      expect(button('Save').disabled).toBe(true);

      await click('720p');
      expect(button('Save').disabled).toBe(false);
      await click('1080p');

      expect(button('Save').disabled).toBe(true);
    });

    it('goes back to the menu on Cancel', async () => {
      await setup();
      await openCanvas();

      await click('Cancel');

      expect(element.querySelector('sf-canvas-picker')).toBeNull();
      expect(element.querySelector('.c-menu-item')).not.toBeNull();
    });
  });

  describe('another resolution of the same format', () => {
    it('is sent without a question and says that every element scales in proportion', async () => {
      await setup();
      await openCanvas();

      await click('720p');
      expect(text(element)).toContain('every element is scaled in proportion');
      await click('Save');
      harness.http
        .expectOne(CANVAS_URL)
        .flush(productionFixture({ canvas: canvasDto('widescreen', 'p720') }));
      await render();

      expect(element.querySelector('sf-confirm-box')).toBeNull();
      expect(element.querySelector('sf-canvas-picker')).toBeNull();
    });

    it('sends format and resolution and announces the new size', async () => {
      await setup();
      await openCanvas();

      await click('720p');
      await click('Save');
      const request = harness.http.expectOne(CANVAS_URL);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ format: 'widescreen', resolution: 'p720' });
      request.flush(productionFixture({ canvas: canvasDto('widescreen', 'p720') }));
      await render();

      expect(TestBed.inject(ToastService).current()?.message).toBe(
        'Output is now 1280 × 720 (16:9)',
      );
    });
  });

  describe('another format', () => {
    it('asks first when scenes have elements: the consequences, and nothing is sent yet', async () => {
      await setup();
      await openCanvas();

      await click('9:16');
      await click('Save');

      const box = element.querySelector('sf-confirm-box');
      expect(text(box)).toContain('The elements of 2 scenes are scaled to fit the new canvas');
      expect(text(box)).toContain('undo history');
      harness.http.expectNone(CANVAS_URL);
    });

    it('sends the change after the confirmation', async () => {
      await setup();
      await openCanvas();
      await click('1:1');
      await click('Save');

      await click('Change format');
      const request = harness.http.expectOne(CANVAS_URL);
      expect(request.request.body).toEqual({ format: 'square', resolution: 'p1080' });
      request.flush(productionFixture({ canvas: canvasDto('square', 'p1080') }));
      await render();

      expect(element.querySelector('sf-canvas-picker')).toBeNull();
    });

    it('sends nothing when the question is cancelled and goes back to the choice', async () => {
      await setup();
      await openCanvas();
      await click('1:1');
      await click('Save');

      await click('Cancel');

      expect(element.querySelector('sf-confirm-box')).toBeNull();
      expect(element.querySelector('sf-canvas-picker')).not.toBeNull();
      harness.http.expectNone(CANVAS_URL);
    });

    it('drops the question when the choice changes again', async () => {
      await setup();
      await openCanvas();
      await click('1:1');
      await click('Save');

      await click('4:3');

      expect(element.querySelector('sf-confirm-box')).toBeNull();
    });

    it('names one scene in the singular', async () => {
      await setup(
        snapshotFixture({
          scenes: [snapshotFixture().scenes[0], sceneFixture('scn_empty', 'Break', 1)],
        }),
      );
      await openCanvas();

      await click('4:3');
      await click('Save');

      expect(text(element.querySelector('sf-confirm-box'))).toContain(
        'The elements of 1 scene are scaled',
      );
    });

    it('does not ask when no scene has elements', async () => {
      await setup(snapshotFixture({ scenes: [sceneFixture('scn_a', 'Welcome', 0)] }));
      await openCanvas();

      await click('9:16');
      await click('Save');

      expect(element.querySelector('sf-confirm-box')).toBeNull();
      const request = harness.http.expectOne(CANVAS_URL);
      expect(request.request.body).toEqual({ format: 'portrait', resolution: 'p1080' });
      request.flush(productionFixture({ canvas: canvasDto('portrait', 'p1080') }));
    });
  });

  describe('while the broadcast is live', () => {
    it('explains why nothing can be changed and disables the choice and Save', async () => {
      await setup(snapshotFixture({ production: productionFixture({ broadcast: 'live' }) }));

      await openCanvas();

      expect(text(element.querySelector('[role="status"]'))).toContain(
        'while the broadcast is live',
      );
      const choices = Array.from(element.querySelectorAll<HTMLButtonElement>('.c-seg button'));
      expect(choices.every((choice) => choice.disabled)).toBe(true);
      expect(element.querySelector('button[type="submit"]')).toBeNull();
    });

    it('does not send anything when the form is submitted anyway', async () => {
      await setup(snapshotFixture({ production: productionFixture({ broadcast: 'live' }) }));
      await openCanvas();

      await submit();

      harness.http.expectNone(CANVAS_URL);
    });
  });

  describe('when the server refuses', () => {
    it('shows the reason as a toast and stays in the form', async () => {
      await setup(snapshotFixture({ scenes: [sceneFixture('scn_a', 'Welcome', 0)] }));
      await openCanvas();
      await click('4:3');
      await click('Save');

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
      expect(element.querySelector('sf-canvas-picker')).not.toBeNull();
    });
  });

  describe('new production', () => {
    async function openCreate(): Promise<void> {
      await click('New production…');
    }

    it('starts with 16:9 and 1080p', async () => {
      await setup();

      await openCreate();

      expect(text(element.querySelector('.c-pop-h'))).toBe('New production');
      expect(pressed()).toEqual(['16:9', '1080p']);
    });

    it('creates the production with the chosen format and resolution', async () => {
      await setup();
      await openCreate();
      const name = element.querySelector<HTMLInputElement>('input[type="text"]')!;
      name.value = 'Reel';
      name.dispatchEvent(new Event('input'));

      await click('9:16');
      await click('720p');
      await click('Create');

      const request = harness.http.expectOne('/api/productions');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        name: 'Reel',
        format: 'portrait',
        resolution: 'p720',
      });
    });

    it('starts at 16:9 · 1080p again after an earlier choice', async () => {
      await setup();
      await openCreate();
      await click('1:1');
      await click('Cancel');

      await openCreate();

      expect(pressed()).toEqual(['16:9', '1080p']);
    });
  });
});
