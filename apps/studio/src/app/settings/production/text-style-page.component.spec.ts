import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import { SCENE_RENDERER_FACTORY } from '../../stage/scene-view.component';
import { FakeRendererFactory } from '../../stage/testing/stage-fakes';
import { TextStylePageComponent } from './text-style-page.component';

const BASE = `/api/productions/${PRODUCTION_ID}`;

describe('TextStylePageComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<TextStylePageComponent>;
  let element: HTMLElement;
  let renderers: FakeRendererFactory;

  async function setup(): Promise<void> {
    const hub = new FakeStudioHub();
    renderers = new FakeRendererFactory();
    TestBed.configureTestingModule({
      providers: [
        ...studioTestProviders(hub),
        { provide: SCENE_RENDERER_FACTORY, useValue: renderers.create },
      ],
    });
    harness = await startStore(hub, snapshotFixture({ production: productionFixture() }));
    fixture = TestBed.createComponent(TextStylePageComponent);
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
    return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (entry) => text(entry) === label,
    ) as HTMLButtonElement;
  }

  function hex(label: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`input[aria-label="${label}, hex value"]`)!;
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  afterEach(() => harness.http.verify());

  it('shows the colours of the production, what each one colours, and a sample drawn in them', async () => {
    await setup();

    expect([hex('Accent').value, hex('Background').value, hex('Text').value]).toEqual([
      '#1f6feb',
      '#0d1117',
      '#ffffff',
    ]);
    expect(text()).toContain('Bar or line beside the text');
    const sample = renderers.last;
    expect(sample.current?.items.map((item) => item.source)).toEqual([
      'txt_sample_title',
      'txt_sample_lower',
      'txt_sample_note',
    ]);
    expect(sample.options.textTheme?.()).toEqual({
      accent: '#1f6feb',
      background: '#0d1117',
      foreground: '#ffffff',
    });
    expect(sample.options.textOf?.('txt_sample_lower')).toMatchObject({
      line1: 'Name',
      line2: 'Role',
      style: 'lowerThird',
    });
    expect(element.querySelector('[role="status"]')).toBeNull();
    expect(button('Save colours').disabled).toBe(true);
  });

  it('redraws the sample in the colours as they are typed', async () => {
    await setup();
    type(hex('Accent'), '#FF8800');
    await render();
    expect(renderers.last.options.textTheme?.()?.accent).toBe('#ff8800');
  });

  it('advises in neutral words below 4.5 : 1, with the ratio rounded down', async () => {
    await setup();

    type(hex('Background'), '#ffffff');
    type(hex('Text'), '#777777');
    await render();

    const advice = element.querySelector('[role="status"]');
    expect(text(advice)).toBe(
      'Contrast 4.4 : 1. The text is hard to read on this background; aim for at least 4.5 : 1.',
    );
    expect(advice?.classList.contains('c-field-error')).toBe(false);
    expect(button('Save colours').disabled).toBe(false);

    type(hex('Text'), '#767676');
    await render();
    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it('saves the colours in lower case; the output follows through the production event', async () => {
    await setup();
    type(hex('Accent'), '#FF8800');
    type(hex('Background'), '#001122');
    await render();
    button('Save colours').click();
    await render();

    const request = harness.http.expectOne(BASE);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      name: null,
      standbySlate: null,
      endSlate: null,
      textTheme: { accent: '#ff8800', background: '#001122', foreground: '#ffffff' },
    });
    request.flush(productionFixture());
    await render();
    expect(TestBed.inject(ToastService).current()?.message).toBe('Text colours saved');
    expect(button('Save colours').disabled).toBe(true);
  });

  it('does not send an invalid colour and says so at the field', async () => {
    await setup();
    type(hex('Accent'), 'orange');
    await render();
    button('Save colours').click();
    await render();

    harness.http.expectNone(BASE);
    expect(text(element.querySelector('.c-field-error'))).toBe(
      'Enter the colour as #rrggbb, for example #1f6feb.',
    );
    // The sample keeps the last valid colours.
    expect(renderers.last.options.textTheme?.()?.accent).toBe('#1f6feb');
  });

  it('fills in the default colours without saving, then saving applies them', async () => {
    await setup();
    harness.emitEvent({
      type: 'productionChanged',
      production: productionFixture({
        textTheme: { accent: '#ff0000', background: '#ffffff', foreground: '#000000' },
      }),
    });
    await render();
    expect(hex('Accent').value).toBe('#ff0000');
    expect(button('Use default colours').disabled).toBe(false);

    button('Use default colours').click();
    await render();

    expect(hex('Accent').value).toBe('#1f6feb');
    expect(button('Use default colours').disabled).toBe(true);
    expect(text(element.querySelector('.c-form-actions__state'))).toBe('Unsaved changes');
    harness.http.expectNone(BASE);
  });
});
