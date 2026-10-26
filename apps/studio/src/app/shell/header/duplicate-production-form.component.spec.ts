import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { AssetDto, ProductionDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { PRODUCTION_ID, productionFixture, snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { ToastService } from '../../core/ui/toast.service';
import {
  DuplicateProductionFormComponent,
  defaultCopyName,
} from './duplicate-production-form.component';

const DUPLICATE = `/api/productions/${PRODUCTION_ID}/duplicate`;

function asset(id: string, code: string, sizeBytes: number): AssetDto {
  return {
    id,
    code,
    kind: 'image',
    name: `Medium ${code}`,
    contentType: 'image/png',
    sizeBytes,
    width: 1920,
    height: 1080,
    createdAt: '2026-10-22T09:00:00.000Z',
    contentUrl: `/api/productions/${PRODUCTION_ID}/assets/${id}/content`,
  };
}

describe('defaultCopyName', () => {
  it('appends "(copy)" and keeps the whole within the limit for names', () => {
    expect(defaultCopyName('Webinar')).toBe('Webinar (copy)');
    const long = defaultCopyName('x'.repeat(80));
    expect(long).toHaveLength(80);
    expect(long.endsWith(' (copy)')).toBe(true);
  });
});

describe('DuplicateProductionFormComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<DuplicateProductionFormComponent>;
  let element: HTMLElement;
  let done: ProductionDto[];
  let cancelled: number;

  async function setup(assets = false): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(
      hub,
      snapshotFixture({
        production: productionFixture({ name: 'Webinar' }),
        assets: assets ? [asset('ast_1', 'M1', 1_048_576), asset('ast_2', 'M2', 2_097_152)] : [],
      }),
    );
    fixture = TestBed.createComponent(DuplicateProductionFormComponent);
    done = [];
    cancelled = 0;
    fixture.componentInstance.done.subscribe((production) => done.push(production));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    element = fixture.nativeElement as HTMLElement;
    await render();
  }

  async function render(): Promise<void> {
    await flushMicrotasks();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function nameField(): HTMLInputElement {
    return element.querySelector<HTMLInputElement>('#duplicate-name')!;
  }

  function type(value: string): void {
    nameField().value = value;
    nameField().dispatchEvent(new Event('input'));
  }

  async function submit(): Promise<void> {
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await render();
  }

  afterEach(() => harness.http.verify());

  it('starts with "Name (copy)" and says what is copied', async () => {
    await setup(true);
    expect(nameField().value).toBe('Webinar (copy)');
    expect(element.textContent).toContain('Cameras and screens become placeholders');
    expect(element.textContent).toContain('2 media files (3 MB) are copied.');
  });

  it('says when there is no media to copy', async () => {
    await setup();
    expect(element.textContent).toContain('There are no media files to copy.');
  });

  it('duplicates with the typed name, confirms and reports the new production', async () => {
    await setup();
    type('  Webinar, second run ');
    await submit();
    const request = harness.http.expectOne(DUPLICATE);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Webinar, second run' });
    // A second submit while it runs sends nothing.
    await submit();
    harness.http.expectNone(DUPLICATE);
    const created = { id: 'prd_new', name: 'Webinar, second run', isActive: false };
    request.flush(created, { status: 201, statusText: 'Created' });
    await render();
    expect(done).toEqual([created]);
    expect(TestBed.inject(ToastService).current()?.message).toBe(
      'Production “Webinar, second run” created. It is not active; switch to it when you are ready.',
    );
  });

  it('does not send an empty name and marks the field', async () => {
    await setup();
    type('   ');
    await submit();
    harness.http.expectNone(DUPLICATE);
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(element.querySelector('.c-field-error')).not.toBeNull();
    expect(done).toEqual([]);
  });

  it('shows the reason under the button when the server refuses, and stays open', async () => {
    await setup();
    await submit();
    harness.http
      .expectOne(DUPLICATE)
      .flush({ status: 409, code: 'limit_reached' }, { status: 409, statusText: 'Conflict' });
    await render();
    expect(element.querySelector('.c-field-error')?.textContent?.trim()).toBe(
      'The limit has been reached.',
    );
    expect(done).toEqual([]);
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it('cancels without a request', async () => {
    await setup();
    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cancel')!
      .click();
    expect(cancelled).toBe(1);
    harness.http.expectNone(DUPLICATE);
  });
});
