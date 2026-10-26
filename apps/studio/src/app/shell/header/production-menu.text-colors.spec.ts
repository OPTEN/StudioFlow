import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { PopoverService } from '../../core/ui/popover.directive';
import { PRODUCTION_POPOVER, ProductionMenuComponent } from './production-menu.component';

const BASE = `/api/productions/${PRODUCTION_ID}`;

describe('ProductionMenuComponent: text colours', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<ProductionMenuComponent>;
  let element: HTMLElement;

  async function setup(): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshotFixture({ production: productionFixture() }));
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
    return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (entry) => text(entry) === label,
    ) as HTMLButtonElement;
  }

  function hex(label: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(
      `input[aria-label="${label}, hex value"]`,
    ) as HTMLInputElement;
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function openColours(): Promise<void> {
    button('Text colours…').click();
    await render();
  }

  afterEach(() => harness.http.verify());

  it('opens the form with the colours of the production and a sample', async () => {
    await setup();

    await openColours();

    expect(text(element.querySelector('.c-pop-h'))).toBe('Text colours');
    expect([hex('Accent').value, hex('Background').value, hex('Text').value]).toEqual([
      '#1f6feb',
      '#0d1117',
      '#ffffff',
    ]);
    const sample = element.querySelector<HTMLElement>('.c-prod__sample');
    expect(sample?.style.backgroundColor).toBe('#0d1117');
    expect(text(sample)).toBe('NameRole');
    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it('warns below 4.5 : 1 and names the ratio rounded down, so it never reads 4.5', async () => {
    await setup();
    await openColours();

    type(hex('Background'), '#ffffff');
    type(hex('Text'), '#777777');
    await render();

    expect(text(element.querySelector('[role="status"]'))).toBe(
      'Contrast 4.4 : 1. The text is hard to read on this background; aim for at least 4.5 : 1.',
    );
  });

  it('does not warn at 4.5 : 1 or more', async () => {
    await setup();
    await openColours();

    type(hex('Background'), '#ffffff');
    type(hex('Text'), '#767676');
    await render();

    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it('saves the colours and the output follows through the production event', async () => {
    await setup();
    await openColours();

    type(hex('Accent'), '#FF8800');
    type(hex('Background'), '#001122');
    button('Save').click();

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
  });

  it('does not send an invalid colour and says so', async () => {
    await setup();
    await openColours();

    type(hex('Accent'), 'orange');
    button('Save').click();
    await render();

    harness.http.expectNone(BASE);
    expect(text(element.querySelector('.c-field-error'))).toBe(
      'Enter every colour as #rrggbb, for example #1f6feb.',
    );
    expect(element.querySelector('.c-prod__sample')).toBeNull();
  });

  it('resets to the default colours without saving', async () => {
    await setup();
    await openColours();
    type(hex('Accent'), '#ff0000');

    button('Reset to defaults').click();
    await render();

    expect(hex('Accent').value).toBe('#1f6feb');
    harness.http.expectNone(BASE);
  });
});
