import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { SourceDto, SourcePlaceholderDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import {
  PRODUCTION_ID,
  deviceFixture,
  itemFixture,
  placeholderFixture,
  sceneFixture,
  sourceFixture,
} from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { dockSnapshot } from '../testing/dock-fixtures';
import { PlaceholderOfferComponent } from './placeholder-offer.component';

const BASE = `/api/productions/${PRODUCTION_ID}/placeholders`;
const K1 = placeholderFixture('K1', 'Stage phone');
const K2 = placeholderFixture('K2', 'Wide shot');
const S1 = placeholderFixture('S1', 'Lea laptop');
const NEW_DEVICE = 'dev_dddddddddddddddd';
const NEW_PHONE = sourceFixture(NEW_DEVICE, 'camera', 'K3', { label: 'New phone' });

@Component({
  imports: [PlaceholderOfferComponent],
  template: '<sf-placeholder-offer [sources]="sources()" />',
})
class HostComponent {
  readonly sources = signal<readonly SourceDto[]>([NEW_PHONE]);
}

describe('PlaceholderOfferComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<HostComponent>;
  let element: HTMLElement;

  async function setup(placeholders: SourcePlaceholderDto[] = [K1]): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      dockSnapshot({
        placeholders,
        scenes: [sceneFixture('scn_a', 'Welcome', 0, [itemFixture('itm_a1', K1.sourceId)])],
        sources: [NEW_PHONE],
        devices: [deviceFixture(NEW_DEVICE, 'New phone')],
      }),
    );
    fixture = TestBed.createComponent(HostComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function buttons(): string[] {
    return Array.from(element.querySelectorAll('button')).map((button) =>
      (button.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  afterEach(() => harness.http.verify());

  it('offers "Use as K1 · Stage phone" to a new camera and assigns it with one click', async () => {
    await setup();
    expect(buttons()).toEqual(['Use as K1 · Stage phone']);
    expect(element.textContent).toContain('This device can take the place of a missing source:');
    element.querySelector<HTMLButtonElement>('[data-placeholder="K1"]')!.click();
    const request = harness.http.expectOne(`${BASE}/${K1.id}/assignment`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ sourceId: NEW_PHONE.id });
    request.flush({ scenes: 1, items: 1 });
    await render();
    expect(TestBed.inject(ToastService).current()?.message).toBe(
      'The scenes now show New phone in place of K1 · Stage phone.',
    );
  });

  it('offers every placeholder of the same kind, sorted, and none of another kind', async () => {
    await setup([S1, K2, K1]);
    expect(buttons()).toEqual(['Use as K1 · Stage phone', 'Use as K2 · Wide shot']);
  });

  it('offers nothing in a production without placeholders', async () => {
    await setup([]);
    expect(element.querySelector('.c-st-offer')).toBeNull();
  });

  it('stops offering a station as soon as a scene uses it', async () => {
    await setup();
    expect(element.querySelector('.c-st-offer')).not.toBeNull();
    // A scene shows the new camera: it is no candidate any more.
    harness.emitEvent({
      type: 'sceneUpserted',
      scene: sceneFixture('scn_a', 'Welcome', 0, [
        itemFixture('itm_a1', K1.sourceId),
        itemFixture('itm_a2', NEW_PHONE.id),
      ]),
    });
    await harness.settle();
    await render();
    expect(element.querySelector('.c-st-offer')).toBeNull();
  });

  it('shows at most four offers and counts the rest', async () => {
    const many = ['K1', 'K2', 'K4', 'K5', 'K6', 'K8'].map((code) => placeholderFixture(code, code));
    await setup(many);
    expect(buttons()).toHaveLength(4);
    expect(element.querySelector('.c-st-offer__more')?.textContent?.trim()).toBe(
      '2 more under “Missing sources”',
    );
  });
});
