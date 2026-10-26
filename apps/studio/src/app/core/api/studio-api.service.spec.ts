import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiError } from './api-error';
import { CSRF_HEADER, csrfInterceptor, isSameOrigin } from './csrf.interceptor';
import { StudioApiService } from './studio-api.service';

/** Minimal XMLHttpRequest stand-in for upload tests. */
class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  responseText = '';
  withCredentials = false;
  aborted = false;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private readonly responseHeaders: Record<string, string> = {};

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name] ?? null;
  }

  send(body: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  respond(status: number, body: string, headers: Record<string, string> = {}): void {
    this.status = status;
    this.responseText = body;
    Object.assign(this.responseHeaders, headers);
    this.onload?.();
  }

  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true } as ProgressEvent);
  }
}

describe('StudioApiService', () => {
  let api: StudioApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(StudioApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('switches the program with the transition and the CSRF header', async () => {
    const result = api.switchProgram('prd_1', {
      sceneId: 'scn_b',
      transition: { kind: 'fade', durationMs: 300 },
    });
    const request = http.expectOne('/api/productions/prd_1/program');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      sceneId: 'scn_b',
      transition: { kind: 'fade', durationMs: 300 },
    });
    expect(request.request.headers.get(CSRF_HEADER)).toBe('1');
    request.flush({ id: 'prd_1' });
    await expect(result).resolves.toEqual({ id: 'prd_1' });
  });

  it('changes the canvas with PUT …/canvas and the CSRF header', async () => {
    const result = api.changeCanvas('prd_1', { format: 'portrait', resolution: 'p720' });
    const request = http.expectOne('/api/productions/prd_1/canvas');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ format: 'portrait', resolution: 'p720' });
    expect(request.request.headers.get(CSRF_HEADER)).toBe('1');
    request.flush({ id: 'prd_1' });
    await expect(result).resolves.toEqual({ id: 'prd_1' });
  });

  it('creates a production with its format and resolution', async () => {
    const result = api.createProduction({ name: 'Reel', format: 'square', resolution: 'p1080' });
    const request = http.expectOne('/api/productions');
    expect(request.request.body).toEqual({ name: 'Reel', format: 'square', resolution: 'p1080' });
    request.flush({ id: 'prd_2' });
    await result;
  });

  it('creates, updates and deletes texts under /texts', async () => {
    const body = { line1: 'Mia', line2: null, style: 'lowerThird', align: null } as const;
    const created = api.createText('prd_1', body);
    const create = http.expectOne('/api/productions/prd_1/texts');
    expect([create.request.method, create.request.body]).toEqual(['POST', body]);
    expect(create.request.headers.get(CSRF_HEADER)).toBe('1');
    create.flush({ id: 'txt_1' });
    await created;

    const updated = api.updateText('prd_1', 'txt/1', { ...body, align: 'left' });
    const update = http.expectOne('/api/productions/prd_1/texts/txt%2F1');
    expect(update.request.method).toBe('PUT');
    update.flush({ id: 'txt/1' });
    await updated;

    const deleted = api.deleteText('prd_1', 'txt_1');
    const remove = http.expectOne('/api/productions/prd_1/texts/txt_1');
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    await deleted;
  });

  it('sends no CSRF header on GET', async () => {
    const result = api.getActiveProduction();
    const request = http.expectOne('/api/productions/active');
    expect(request.request.headers.has(CSRF_HEADER)).toBe(false);
    request.flush({ id: 'prd_1', name: 'Webinar', slug: 'webinar', isActive: true, createdAt: '' });
    await result;
  });

  it('encodes ids in paths', async () => {
    const result = api.updateSceneItem('prd_1', 'scn_a', 'itm/x', {} as never);
    const request = http.expectOne('/api/productions/prd_1/scenes/scn_a/items/itm%2Fx');
    expect(request.request.method).toBe('PUT');
    request.flush({});
    await result;
  });

  it('passes since as query parameter', async () => {
    const result = api.getChanges('prd_1', 41);
    http
      .expectOne('/api/productions/prd_1/changes?since=41')
      .flush({ revision: 41, events: [], snapshot: null });
    await result;
  });

  it('asks for a page of the audit log with the filter as query parameters', async () => {
    const result = api.listAuditLog({
      production: 'prd_1',
      category: ['devices', 'media'],
      action: [],
      q: 'lena',
      limit: 50,
      cursor: undefined,
    });
    const request = http.expectOne((r) => r.url === '/api/audit');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys().sort()).toEqual(['category', 'limit', 'production', 'q']);
    expect(request.request.params.getAll('category')).toEqual(['devices', 'media']);
    expect(request.request.params.get('limit')).toBe('50');
    expect(request.request.headers.has(CSRF_HEADER)).toBe(false);
    request.flush({ entries: [], nextCursor: null });
    await expect(result).resolves.toEqual({ entries: [], nextCursor: null });
  });

  it('exports the audit log as text and takes the file name from the server', async () => {
    const result = api.exportAuditLog('csv', { production: 'prd_1', separator: 'semicolon' });
    const request = http.expectOne((r) => r.url === '/api/audit/export.csv');
    expect(request.request.params.get('separator')).toBe('semicolon');
    expect(request.request.responseType).toBe('text');
    request.flush('time;actor\r\n', {
      headers: { 'Content-Disposition': 'attachment; filename="studioflow-audit-2026-10-26.csv"' },
    });
    await expect(result).resolves.toEqual({
      text: 'time;actor\r\n',
      fileName: 'studioflow-audit-2026-10-26.csv',
    });
  });

  it('falls back to a plain file name and rejects a refused export with the problem code', async () => {
    const plain = api.exportAuditLog('json', {});
    http.expectOne('/api/audit/export.json').flush('[]');
    await expect(plain).resolves.toEqual({ text: '[]', fileName: 'studioflow-audit.json' });

    const refused = api.exportAuditLog('csv', {});
    http
      .expectOne('/api/audit/export.csv')
      .flush(JSON.stringify({ status: 409, code: 'limit_reached' }), {
        status: 409,
        statusText: 'Conflict',
      });
    await expect(refused).rejects.toMatchObject({ status: 409, code: 'limit_reached' });
  });

  it('resolves void for 204 answers', async () => {
    const result = api.acknowledgeIncident('prd_1', 'inc_1');
    http
      .expectOne('/api/productions/prd_1/incidents/inc_1/ack')
      .flush(null, { status: 204, statusText: 'No Content' });
    await expect(result).resolves.toBeNull();
  });

  it('asks for the first-run setup status without the CSRF header', async () => {
    const result = api.getSetupStatus();
    const request = http.expectOne('/api/auth/setup');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.has(CSRF_HEADER)).toBe(false);
    request.flush({ setupRequired: true });
    await expect(result).resolves.toEqual({ setupRequired: true });
  });

  it('completes the first-run setup with code, username and password', async () => {
    const result = api.completeSetup({ setupCode: 'K7QM-3XD2', username: 'regie', password: 'p' });
    const request = http.expectOne('/api/auth/setup');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      setupCode: 'K7QM-3XD2',
      username: 'regie',
      password: 'p',
    });
    request.flush({ username: 'regie' });
    await expect(result).resolves.toEqual({ username: 'regie' });
  });

  it('changes the password with the CSRF header and resolves void', async () => {
    const result = api.changePassword({ currentPassword: 'old', newPassword: 'new' });
    const request = http.expectOne('/api/auth/password');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ currentPassword: 'old', newPassword: 'new' });
    expect(request.request.headers.get(CSRF_HEADER)).toBe('1');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await expect(result).resolves.toBeNull();
  });

  it('rejects with an ApiError carrying the problem code', async () => {
    const result = api.take('prd_1', { transition: { kind: 'cut', durationMs: 0 } });
    http
      .expectOne('/api/productions/prd_1/take')
      .flush({ code: 'conflict', detail: 'No preview.' }, { status: 409, statusText: 'Conflict' });
    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).code).toBe('conflict');
  });

  it('uploads with XHR, progress and the CSRF header', async () => {
    api.xhrFactory = () => new FakeXhr() as unknown as XMLHttpRequest;
    const progress: (number | null)[] = [];
    const file = new File(['x'], 'Titel.png', { type: 'image/png' });
    const result = api.uploadAsset('prd_1', file, { onProgress: (p) => progress.push(p.fraction) });
    const xhr = FakeXhr.last as FakeXhr;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/productions/prd_1/assets');
    expect(xhr.headers[CSRF_HEADER]).toBe('1');
    expect(xhr.body).toBeInstanceOf(FormData);
    xhr.progress(50, 100);
    xhr.respond(201, '{"id":"ast_1"}');
    await expect(result).resolves.toEqual({ id: 'ast_1' });
    expect(progress).toEqual([0.5]);
  });

  it('rejects uploads with the server error and on abort', async () => {
    api.xhrFactory = () => new FakeXhr() as unknown as XMLHttpRequest;
    const file = new File(['x'], 'a.svg');
    const failing = api.uploadAsset('prd_1', file);
    (FakeXhr.last as FakeXhr).respond(415, '{"code":"unsupported_media"}');
    await expect(failing).rejects.toMatchObject({ status: 415, code: 'unsupported_media' });

    const controller = new AbortController();
    const aborted = api.uploadAsset('prd_1', file, { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: 'aborted' });
    expect((FakeXhr.last as FakeXhr).aborted).toBe(true);
  });
});

describe('isSameOrigin', () => {
  it('accepts relative and same-origin URLs only', () => {
    expect(isSameOrigin('/api/x', 'https://studio.test')).toBe(true);
    expect(isSameOrigin('https://studio.test/api', 'https://studio.test')).toBe(true);
    expect(isSameOrigin('https://evil.test/api', 'https://studio.test')).toBe(false);
    expect(isSameOrigin('//evil.test/api', 'https://studio.test')).toBe(false);
  });
});
