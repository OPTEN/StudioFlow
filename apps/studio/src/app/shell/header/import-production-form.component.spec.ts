import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ImportPreviewDto, ProductionDto } from '@studioflow/scene-model';
import { FakeStudioHub, flushMicrotasks } from '../../../testing/fake-studio-hub';
import { FakeXhr } from '../../../testing/fake-xhr';
import { snapshotFixture } from '../../../testing/fixtures';
import { startStore, studioTestProviders, type StoreHarness } from '../../../testing/store-harness';
import { StudioApiService } from '../../core/api/studio-api.service';
import { ToastService } from '../../core/ui/toast.service';
import { ImportProductionFormComponent } from './import-production-form.component';

const PREVIEW: ImportPreviewDto = {
  name: 'Webinar (2)',
  appVersion: '1.4.0',
  scenes: 3,
  texts: 2,
  media: 2,
  mediaBytes: 3_145_728,
  placeholders: [
    { code: 'K1', kind: 'camera', label: 'Stage phone' },
    { code: 'S1', kind: 'screen', label: null },
  ],
  warnings: [
    { code: 'nameChanged', params: { name: 'Webinar (2)' } },
    { code: 'placeholders', params: { count: '2' } },
  ],
};

describe('ImportProductionFormComponent', () => {
  let harness: StoreHarness;
  let fixture: ComponentFixture<ImportProductionFormComponent>;
  let element: HTMLElement;
  let done: ProductionDto[];
  let cancelled: number;
  const requests: FakeXhr[] = [];

  async function setup(): Promise<void> {
    const hub = new FakeStudioHub();
    TestBed.configureTestingModule({ providers: studioTestProviders(hub) });
    harness = await startStore(hub, snapshotFixture());
    requests.length = 0;
    TestBed.inject(StudioApiService).xhrFactory = () => {
      const xhr = new FakeXhr();
      requests.push(xhr);
      return xhr as unknown as XMLHttpRequest;
    };
    fixture = TestBed.createComponent(ImportProductionFormComponent);
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

  async function choose(name = 'Webinar.studioflow.zip'): Promise<void> {
    const input = element.querySelector<HTMLInputElement>('[data-testid="import-file"]')!;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['PK'], name, { type: 'application/zip' })],
    });
    input.dispatchEvent(new Event('change'));
    await render();
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!found) {
      throw new Error(`no button "${label}"`);
    }
    return found;
  }

  function text(selector: string): string {
    return (element.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  afterEach(() => harness.http.verify());

  it('starts with the hint and "Choose file…"', async () => {
    await setup();
    expect(element.textContent).toContain('Choose a file exported from StudioFlow');
    expect(button('Choose file…')).toBeTruthy();
    expect(element.querySelector('[data-testid="import-preview"]')).toBeNull();
    expect(element.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toContain('.zip');
  });

  it('checks the file with a dry run, with progress, and shows what it contains', async () => {
    await setup();
    await choose();
    const dryRun = requests[0];
    expect(dryRun.url).toBe('/api/productions/import?dryRun=true');
    expect(text('.c-xfer__file')).toBe('Checking “Webinar.studioflow.zip”…');
    dryRun.progress(50, 100);
    await render();
    expect(text('.c-xfer .c-hint')).toBe('Uploaded 50%');
    expect(element.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    // Nothing can be started twice while the check runs.
    expect(element.querySelector('[data-testid="import-submit"]')).toBeNull();

    dryRun.respond(200, JSON.stringify(PREVIEW));
    await render();
    expect(text('[data-testid="import-name"]')).toBe('Webinar (2)');
    const lines = Array.from(element.querySelectorAll('.c-xfer__list')[0].children).map((li) =>
      (li.textContent ?? '').trim(),
    );
    expect(lines).toEqual(['3 scenes', '2 texts', '2 media files · 3 MB']);
    expect(text('[data-testid="import-placeholders"]')).toBe('K1 Stage phone S1 removed source');
    const warnings = Array.from(element.querySelectorAll('.c-xfer__warn')).map((node) =>
      (node.textContent ?? '').trim(),
    );
    expect(warnings).toEqual([
      'A production with this name exists already. It is imported as “Webinar (2)”.',
      '2 cameras and screens of the original become placeholders. Pair devices and assign them to bring the pictures back.',
    ]);
    expect(element.textContent).toContain('Exported with StudioFlow 1.4.0');
    expect(button('Import').disabled).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('imports after the preview, reports the new production and confirms with a toast', async () => {
    await setup();
    await choose();
    requests[0].respond(200, JSON.stringify(PREVIEW));
    await render();

    button('Import').click();
    await render();
    const real = requests[1];
    expect(real.url).toBe('/api/productions/import');
    expect(button('Import').disabled).toBe(true);
    const created = { id: 'prd_new', name: 'Webinar (2)', isActive: false };
    real.respond(201, JSON.stringify(created));
    await render();
    expect(done).toEqual([created]);
    expect(TestBed.inject(ToastService).current()?.message).toBe(
      'Production “Webinar (2)” imported. It is not active; switch to it when you are ready.',
    );
  });

  it('explains a file that is not a StudioFlow export and offers another try', async () => {
    await setup();
    await choose('photo.zip');
    requests[0].respond(400, '{"code":"invalid_archive"}');
    await render();
    expect(text('.c-field-error')).toBe(
      'This file is not a valid StudioFlow export, or it is damaged. Nothing was imported.',
    );
    expect(element.querySelector('[data-testid="import-preview"]')).toBeNull();
    expect(button('Choose file…')).toBeTruthy();
  });

  it('says so when the file comes from a newer version', async () => {
    await setup();
    await choose();
    requests[0].respond(400, '{"code":"unsupported_format"}');
    await render();
    expect(text('.c-field-error')).toContain('exported by a newer version of StudioFlow');
  });

  it('shows "too large for this installation" and not the message about media for a 413', async () => {
    await setup();
    await choose();
    requests[0].respond(413, '{"code":"archive_too_large"}');
    await render();
    expect(text('.c-field-error')).toBe(
      'This file is larger than this installation accepts. Nothing was imported.',
    );
  });

  it('keeps the preview and shows the reason when the import itself is refused', async () => {
    await setup();
    await choose();
    requests[0].respond(200, JSON.stringify(PREVIEW));
    await render();
    button('Import').click();
    await render();
    requests[1].respond(409, '{"code":"limit_reached"}');
    await render();
    expect(text('.c-field-error')).toBe('The limit has been reached.');
    expect(element.querySelector('[data-testid="import-preview"]')).not.toBeNull();
    expect(button('Import').disabled).toBe(false);
    expect(done).toEqual([]);
  });

  it('cancels a running check without an error', async () => {
    await setup();
    await choose();
    button('Cancel').click();
    await render();
    expect(requests[0].aborted).toBe(true);
    expect(element.querySelector('.c-field-error')).toBeNull();
    expect(button('Choose file…')).toBeTruthy();
    expect(cancelled).toBe(0);
  });

  it('closes the form on Cancel when nothing runs', async () => {
    await setup();
    button('Cancel').click();
    expect(cancelled).toBe(1);
    expect(requests).toHaveLength(0);
  });

  it('chooses another file after a preview and checks that one instead', async () => {
    await setup();
    await choose('first.studioflow.zip');
    requests[0].respond(200, JSON.stringify(PREVIEW));
    await render();
    await choose('second.studioflow.zip');
    expect(requests).toHaveLength(2);
    expect(text('.c-xfer__file')).toBe('Checking “second.studioflow.zip”…');
    expect(element.querySelector('[data-testid="import-preview"]')).toBeNull();
  });
});
