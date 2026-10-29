import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { AssetDto, SlateDto } from '@studioflow/scene-model';
import type { SceneRendererOptions } from '@studioflow/scene-renderer';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { SCENE_RENDERER_FACTORY } from '../../stage/scene-view.component';
import { FakeSceneRenderer } from '../../stage/testing/stage-fakes';
import { SlatesPageComponent } from './slates-page.component';

const BASE = `/api/productions/${PRODUCTION_ID}`;

/** A renderer that also records the slates it is asked to show. */
class SlateRenderer extends FakeSceneRenderer {
  readonly slates: (SlateDto | null)[] = [];

  override showSlate(slate?: SlateDto | null): void {
    this.slates.push(slate ?? null);
  }
}

function image(id: string, code: string, name: string): AssetDto {
  return {
    id,
    code,
    kind: 'image',
    name,
    contentType: 'image/png',
    sizeBytes: 1000,
    width: 1920,
    height: 1080,
    createdAt: '2026-10-22T09:00:00.000Z',
    hasAudio: false,
    contentUrl: `${BASE}/assets/${id}/content`,
  };
}

describe('SlatesPageComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<SlatesPageComponent>;
  let element: HTMLElement;
  let renderers: SlateRenderer[];

  async function setup(snapshot = snapshotFixture()): Promise<void> {
    const hub = new FakeStudioHub();
    renderers = [];
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        {
          provide: SCENE_RENDERER_FACTORY,
          useValue: (container: HTMLElement, options: SceneRendererOptions) => {
            const renderer = new SlateRenderer(container, options);
            renderers.push(renderer);
            return renderer;
          },
        },
      ],
    });
    harness = await startStore(hub, snapshot);
    fixture = TestBed.createComponent(SlatesPageComponent);
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

  function group(name: string): HTMLElement {
    const found = Array.from(element.querySelectorAll<HTMLElement>('[role="group"]')).find(
      (entry) => text(element.querySelector(`#${entry.getAttribute('aria-labelledby')}`)) === name,
    );
    if (!found) {
      throw new Error(`no group "${name}"`);
    }
    return found;
  }

  function field(slate: 'standby' | 'end', name: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`#slate-${slate}-${name}`)!;
  }

  function type(input: HTMLInputElement | HTMLSelectElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
  }

  function save(): HTMLButtonElement {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => text(button) === 'Save slates',
    )!;
  }

  afterEach(() => harness?.http.verify());

  it('explains what the slates are and fills both groups with the saved slates', async () => {
    await setup();
    expect(text(element.querySelector('.c-page__lead'))).toContain(
      'What the audience sees before and after the broadcast.',
    );
    expect(text(group('Before the broadcast'))).toContain('until you start the broadcast');
    expect(field('standby', 'title').value).toBe('Starting soon');
    expect(field('standby', 'subtitle').value).toBe('Webinar');
    expect(field('end', 'title').value).toBe('Thanks for watching');
    expect(field('end', 'subtitle').value).toBe('');
    expect(save().disabled).toBe(true);
  });

  it('marks the slate the output shows now', async () => {
    await setup();
    expect(text(group('Before the broadcast'))).toContain('On the output now');
    expect(text(group('After the broadcast'))).not.toContain('On the output now');
  });

  it('marks the end slate after the broadcast and none while it is live', async () => {
    await setup(snapshotFixture({ production: productionFixture({ broadcast: 'ended' }) }));
    expect(text(group('After the broadcast'))).toContain('On the output now');
    harness.emitEvent({ type: 'productionChanged', production: productionFixture({ broadcast: 'live' }) });
    await render();
    expect(text()).not.toContain('On the output now');
  });

  it('draws each slate as typed in its preview', async () => {
    await setup();
    expect(renderers).toHaveLength(2);
    expect(renderers[0]?.slates.at(-1)).toEqual({
      title: 'Starting soon',
      subtitle: 'Webinar',
      backgroundAssetId: null,
    });
    type(field('standby', 'title'), 'Doors open soon');
    await render();
    expect(renderers[0]?.slates.at(-1)?.title).toBe('Doors open soon');
    expect(renderers[1]?.slates.at(-1)?.title).toBe('Thanks for watching');
    expect(element.querySelector('[aria-label="Preview of the slate “Before the broadcast”"]')).not.toBeNull();
  });

  it('saves both slates, with an empty subtitle as none', async () => {
    await setup();
    type(field('standby', 'subtitle'), '  ');
    type(field('end', 'title'), ' See you ');
    await render();
    expect(save().disabled).toBe(false);
    save().click();
    await render();

    const request = harness.http.expectOne(BASE);
    expect(request.request.body).toEqual({
      name: null,
      standbySlate: { title: 'Starting soon', subtitle: null, backgroundAssetId: null },
      endSlate: { title: 'See you', subtitle: null, backgroundAssetId: null },
    });
    request.flush(productionFixture());
    await render();
    expect(TestBed.inject(ToastService).current()?.message).toBe('Slates saved');
    expect(save().disabled).toBe(true);
  });

  it('refuses an empty title at the field and sends nothing', async () => {
    await setup();
    type(field('end', 'title'), '   ');
    field('end', 'title').dispatchEvent(new Event('blur'));
    await render();
    expect(text(group('After the broadcast').querySelector('.c-field-error'))).toBe(
      'Enter a title of at most 120 characters.',
    );
    save().click();
    await render();
    harness.http.expectNone(BASE);
  });

  it('offers the uploaded images as backgrounds, and says how to get one when there is none', async () => {
    await setup();
    expect(text(group('Before the broadcast'))).toContain('upload an image in the Sources dock');

    harness.emitEvent({ type: 'assetUpserted', asset: image('ast_bg', 'M1', 'Stage') });
    await render();
    const select = element.querySelector<HTMLSelectElement>('#slate-standby-background')!;
    expect(Array.from(select.options).map((option) => text(option))).toEqual(['No image', 'M1 · Stage']);
    type(select, 'ast_bg');
    await render();
    expect(renderers[0]?.slates.at(-1)?.backgroundAssetId).toBe('ast_bg');
  });

  it('follows a change from elsewhere while untouched, and keeps what the operator typed', async () => {
    await setup();
    const changed = (title: string) =>
      productionFixture({
        standbySlate: { title, subtitle: null, backgroundAssetId: null },
      });
    harness.emitEvent({ type: 'productionChanged', production: changed('From the other tab') });
    await render();
    expect(field('standby', 'title').value).toBe('From the other tab');

    type(field('end', 'title'), 'Mine');
    await render();
    harness.emitEvent({ type: 'productionChanged', production: changed('Again') });
    await render();
    expect(field('standby', 'title').value).toBe('From the other tab');
    expect(field('end', 'title').value).toBe('Mine');
  });

  it('discards the changes', async () => {
    await setup();
    type(field('standby', 'title'), 'Changed');
    await render();
    Array.from(element.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => text(button) === 'Discard changes')!
      .click();
    await render();
    expect(field('standby', 'title').value).toBe('Starting soon');
    expect(save().disabled).toBe(true);
  });
});
