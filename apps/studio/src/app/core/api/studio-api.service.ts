import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { operations } from '@studioflow/scene-model';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiError } from './api-error';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './csrf.interceptor';

/** Operation names of the generated OpenAPI contract (`ApiSurface.cs` → `packages/scene-model/src/generated/api.ts`). */
export type ApiOperation = keyof operations;

type Responses<K extends ApiOperation> = operations[K]['responses'];

/** JSON body of the 200 or 201 response of an operation; `void` for 202/204-only operations. */
export type ApiResult<K extends ApiOperation> =
  Responses<K> extends { 200: { content: { 'application/json': infer T } } }
    ? T
    : Responses<K> extends { 201: { content: { 'application/json': infer T } } }
      ? T
      : Responses<K> extends { 202: { content: { 'application/json': infer T } } }
        ? T
        : void;

/** JSON request body of an operation. */
export type ApiBody<K extends ApiOperation> = operations[K] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** Progress of an upload: bytes sent so far and the total (null when the browser does not know it). */
export interface UploadProgress {
  readonly loaded: number;
  readonly total: number | null;
  /** 0–1, or null when the total is unknown. */
  readonly fraction: number | null;
}

/** Options of {@link StudioApiService.uploadAsset}. */
export interface UploadOptions {
  /** Called on every progress event of the request body. */
  readonly onProgress?: (progress: UploadProgress) => void;
  /** Aborting rejects the upload with an `ApiError` of code `aborted`. */
  readonly signal?: AbortSignal;
}

/** Factory for the upload transport; replaced in tests. */
export type XhrFactory = () => XMLHttpRequest;

/** Filter, cursor and page size of `GET /api/audit`. */
export type AuditQuery = NonNullable<operations['listAuditLog']['parameters']['query']>;

/** Filter and separator of the audit exports. */
export type AuditExportQuery = NonNullable<operations['exportAuditCsv']['parameters']['query']>;

/** An exported audit log: the text of the file and its name. */
export interface AuditExport {
  readonly text: string;
  readonly fileName: string;
}

const enc = encodeURIComponent;

/** Query parameters of an object; a list becomes a repeated parameter, an unset value is left out. */
function queryParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [name, value] of Object.entries(query) as [string, unknown][]) {
    for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) {
      if (item !== undefined && item !== null && item !== '') {
        params = params.append(name, String(item));
      }
    }
  }
  return params;
}

/**
 * Typed client for every REST operation the Regie uses (spec 5, `ApiSurface.cs`). Pure transport: no state, no
 * business logic, no toasts. Every method returns a promise that rejects with an {@link ApiError}; callers turn
 * it into a German message with `toUserMessage` (or `ToastService.error`). Production-scoped methods take the
 * production id explicitly (`ProductionStoreService.productionId()`).
 *
 * The CSRF header is added by `csrfInterceptor`; a 401 leads to the login page through `authInterceptor`.
 */
@Injectable({ providedIn: 'root' })
export class StudioApiService {
  private readonly http = inject(HttpClient);
  /** Creates the XMLHttpRequest used for uploads (Fetch cannot report upload progress). */
  xhrFactory: XhrFactory = () => new XMLHttpRequest();

  // ---------------------------------------------------------------- Auth

  /** `POST /api/auth/login`: signs in (sets the session cookie). 401 wrong credentials, 429 lockout. */
  login(body: ApiBody<'login'>): Promise<ApiResult<'login'>> {
    return this.call(this.http.post<ApiResult<'login'>>('/api/auth/login', body));
  }

  /** `POST /api/auth/logout`: ends the session. */
  logout(): Promise<void> {
    return this.call(this.http.post<void>('/api/auth/logout', null));
  }

  /** `GET /api/auth/me`: the signed-in admin; 401 when not signed in. */
  getSession(): Promise<ApiResult<'getSession'>> {
    return this.call(this.http.get<ApiResult<'getSession'>>('/api/auth/me'));
  }

  /** `GET /api/auth/setup`: whether the first-run setup is open (no account yet). Public. */
  getSetupStatus(): Promise<ApiResult<'getSetupStatus'>> {
    return this.call(this.http.get<ApiResult<'getSetupStatus'>>('/api/auth/setup'));
  }

  /**
   * `POST /api/auth/setup`: creates the account and signs it in. 400 with the broken rules in the field errors,
   * 403 wrong setup code, 409 setup already complete, 429 lockout.
   */
  completeSetup(body: ApiBody<'completeSetup'>): Promise<ApiResult<'completeSetup'>> {
    return this.call(this.http.post<ApiResult<'completeSetup'>>('/api/auth/setup', body));
  }

  /** `POST /api/auth/password`: changes the password and ends every other session. 400 wrong current password or rule. */
  changePassword(body: ApiBody<'changePassword'>): Promise<void> {
    return this.call(this.http.post<void>('/api/auth/password', body));
  }

  // ---------------------------------------------------------------- System

  /** `GET /api/system/info`: version and public base URL. */
  getSystemInfo(): Promise<ApiResult<'getSystemInfo'>> {
    return this.call(this.http.get<ApiResult<'getSystemInfo'>>('/api/system/info'));
  }

  // ---------------------------------------------------------------- Productions

  /** `GET /api/productions`. */
  listProductions(): Promise<ApiResult<'listProductions'>> {
    return this.call(this.http.get<ApiResult<'listProductions'>>('/api/productions'));
  }

  /** `POST /api/productions`. */
  createProduction(body: ApiBody<'createProduction'>): Promise<ApiResult<'createProduction'>> {
    return this.call(this.http.post<ApiResult<'createProduction'>>('/api/productions', body));
  }

  /** `GET /api/productions/active`: the production the Regie follows; 404 when there is none. */
  getActiveProduction(): Promise<ApiResult<'getActiveProduction'>> {
    return this.call(this.http.get<ApiResult<'getActiveProduction'>>('/api/productions/active'));
  }

  /** `GET /api/productions/{id}/snapshot`. */
  getSnapshot(productionId: string): Promise<ApiResult<'getSnapshot'>> {
    return this.call(
      this.http.get<ApiResult<'getSnapshot'>>(this.production(productionId, '/snapshot')),
    );
  }

  /** `GET /api/productions/{id}/changes?since=`. */
  getChanges(productionId: string, since: number): Promise<ApiResult<'getChanges'>> {
    const params = new HttpParams().set('since', since);
    return this.call(
      this.http.get<ApiResult<'getChanges'>>(this.production(productionId, '/changes'), { params }),
    );
  }

  /** `PATCH /api/productions/{id}`: name and slates (null fields stay unchanged). */
  updateProduction(
    productionId: string,
    body: ApiBody<'updateProduction'>,
  ): Promise<ApiResult<'updateProduction'>> {
    return this.call(
      this.http.patch<ApiResult<'updateProduction'>>(this.production(productionId), body),
    );
  }

  /** `POST /api/productions/{id}/activate`: every Regie receives `resync` and follows. */
  activateProduction(productionId: string): Promise<ApiResult<'activateProduction'>> {
    return this.post<ApiResult<'activateProduction'>>(this.production(productionId, '/activate'));
  }

  /** `POST /api/productions/{id}/broadcast/start`: standby|ended → live. */
  startBroadcast(productionId: string): Promise<ApiResult<'startBroadcast'>> {
    return this.post<ApiResult<'startBroadcast'>>(
      this.production(productionId, '/broadcast/start'),
    );
  }

  /** `POST /api/productions/{id}/broadcast/end`: live → ended. */
  endBroadcast(productionId: string): Promise<ApiResult<'endBroadcast'>> {
    return this.post<ApiResult<'endBroadcast'>>(this.production(productionId, '/broadcast/end'));
  }

  /** `POST /api/productions/{id}/broadcast/reset`: any → standby. */
  resetBroadcast(productionId: string): Promise<ApiResult<'resetBroadcast'>> {
    return this.post<ApiResult<'resetBroadcast'>>(
      this.production(productionId, '/broadcast/reset'),
    );
  }

  /** `PUT /api/productions/{id}/preview`: sets or clears the preview scene. */
  setPreview(productionId: string, body: ApiBody<'setPreview'>): Promise<ApiResult<'setPreview'>> {
    return this.call(
      this.http.put<ApiResult<'setPreview'>>(this.production(productionId, '/preview'), body),
    );
  }

  /** `POST /api/productions/{id}/program`: direct switch; 409 `transition_running` while a fade runs. */
  switchProgram(
    productionId: string,
    body: ApiBody<'switchProgram'>,
  ): Promise<ApiResult<'switchProgram'>> {
    return this.post<ApiResult<'switchProgram'>>(this.production(productionId, '/program'), body);
  }

  /** `POST /api/productions/{id}/take`: preview ↔ program; 409 `conflict` without a usable preview. */
  take(productionId: string, body: ApiBody<'take'>): Promise<ApiResult<'take'>> {
    return this.post<ApiResult<'take'>>(this.production(productionId, '/take'), body);
  }

  /** `POST /api/productions/{id}/incidents/{incidentId}/ack`: "Seen". */
  acknowledgeIncident(productionId: string, incidentId: string): Promise<void> {
    return this.post<void>(this.production(productionId, `/incidents/${enc(incidentId)}/ack`));
  }

  /** `POST /api/productions/{id}/livekit-token`: token for the Regie's media session (role studio). */
  getStudioLiveKitToken(productionId: string): Promise<ApiResult<'getStudioLiveKitToken'>> {
    return this.post<ApiResult<'getStudioLiveKitToken'>>(
      this.production(productionId, '/livekit-token'),
    );
  }

  /** `GET /api/productions/{id}/telemetry`: latest telemetry of every device. */
  getTelemetry(productionId: string): Promise<ApiResult<'getTelemetry'>> {
    return this.call(
      this.http.get<ApiResult<'getTelemetry'>>(this.production(productionId, '/telemetry')),
    );
  }

  // ---------------------------------------------------------------- Scenes

  /** `POST …/scenes`: new (or cloned) scene; 409 `limit_reached` at 99 scenes. */
  createScene(
    productionId: string,
    body: ApiBody<'createScene'>,
  ): Promise<ApiResult<'createScene'>> {
    return this.post<ApiResult<'createScene'>>(this.production(productionId, '/scenes'), body);
  }

  /** `PATCH …/scenes/{sceneId}`: name, layout mode, background. */
  updateScene(
    productionId: string,
    sceneId: string,
    body: ApiBody<'updateScene'>,
  ): Promise<ApiResult<'updateScene'>> {
    return this.call(
      this.http.patch<ApiResult<'updateScene'>>(this.scene(productionId, sceneId), body),
    );
  }

  /** `DELETE …/scenes/{sceneId}`; 409 `scene_is_live` for the program scene. */
  deleteScene(productionId: string, sceneId: string): Promise<void> {
    return this.call(this.http.delete<void>(this.scene(productionId, sceneId)));
  }

  /** `PUT …/scenes/order`: complete new order. */
  reorderScenes(productionId: string, body: ApiBody<'reorderScenes'>): Promise<void> {
    return this.call(this.http.put<void>(this.production(productionId, '/scenes/order'), body));
  }

  /** `POST …/scenes/{sceneId}/items`: adds a source with server defaults. */
  addSceneItem(
    productionId: string,
    sceneId: string,
    body: ApiBody<'addSceneItem'>,
  ): Promise<ApiResult<'addSceneItem'>> {
    return this.post<ApiResult<'addSceneItem'>>(this.scene(productionId, sceneId, '/items'), body);
  }

  /** `PUT …/scenes/{sceneId}/items/{itemId}`: replaces one item (last writer wins). */
  updateSceneItem(
    productionId: string,
    sceneId: string,
    itemId: string,
    body: ApiBody<'updateSceneItem'>,
  ): Promise<ApiResult<'updateSceneItem'>> {
    return this.call(
      this.http.put<ApiResult<'updateSceneItem'>>(
        this.scene(productionId, sceneId, `/items/${enc(itemId)}`),
        body,
      ),
    );
  }

  /** `DELETE …/scenes/{sceneId}/items/{itemId}`. */
  removeSceneItem(
    productionId: string,
    sceneId: string,
    itemId: string,
  ): Promise<ApiResult<'removeSceneItem'>> {
    return this.call(
      this.http.delete<ApiResult<'removeSceneItem'>>(
        this.scene(productionId, sceneId, `/items/${enc(itemId)}`),
      ),
    );
  }

  /** `PUT …/scenes/{sceneId}/items/order`: the complete z-order (item ids back to front); changes no item. */
  reorderSceneItems(
    productionId: string,
    sceneId: string,
    body: ApiBody<'reorderSceneItems'>,
  ): Promise<ApiResult<'reorderSceneItems'>> {
    return this.call(
      this.http.put<ApiResult<'reorderSceneItems'>>(
        this.scene(productionId, sceneId, '/items/order'),
        body,
      ),
    );
  }

  /** `PUT …/scenes/{sceneId}/items`: replaces all items (templates, undo/redo, adding). */
  replaceSceneItems(
    productionId: string,
    sceneId: string,
    body: ApiBody<'replaceSceneItems'>,
  ): Promise<ApiResult<'replaceSceneItems'>> {
    return this.call(
      this.http.put<ApiResult<'replaceSceneItems'>>(
        this.scene(productionId, sceneId, '/items'),
        body,
      ),
    );
  }

  // ---------------------------------------------------------------- Devices

  /** `PATCH …/devices/{deviceId}`: rename. */
  renameDevice(
    productionId: string,
    deviceId: string,
    body: ApiBody<'renameDevice'>,
  ): Promise<ApiResult<'renameDevice'>> {
    return this.call(
      this.http.patch<ApiResult<'renameDevice'>>(this.device(productionId, deviceId), body),
    );
  }

  /** `POST …/devices/{deviceId}/block`: disconnects the device immediately. */
  blockDevice(productionId: string, deviceId: string): Promise<ApiResult<'blockDevice'>> {
    return this.post<ApiResult<'blockDevice'>>(this.device(productionId, deviceId, '/block'));
  }

  /** `POST …/devices/{deviceId}/unblock`. */
  unblockDevice(productionId: string, deviceId: string): Promise<ApiResult<'unblockDevice'>> {
    return this.post<ApiResult<'unblockDevice'>>(this.device(productionId, deviceId, '/unblock'));
  }

  /** `DELETE …/devices/{deviceId}`: removes the device and its sources. */
  deleteDevice(productionId: string, deviceId: string): Promise<void> {
    return this.call(this.http.delete<void>(this.device(productionId, deviceId)));
  }

  /** `POST …/devices/{deviceId}/commands`: reshare, switchCamera, message (202 even if offline). */
  sendDeviceCommand(
    productionId: string,
    deviceId: string,
    body: ApiBody<'sendDeviceCommand'>,
  ): Promise<ApiResult<'sendDeviceCommand'>> {
    return this.post<ApiResult<'sendDeviceCommand'>>(
      this.device(productionId, deviceId, '/commands'),
      body,
    );
  }

  // ---------------------------------------------------------------- Pairing

  /** `GET …/pairing/phone-invite`: the valid phone invite (created when missing). */
  getPhoneInvite(productionId: string): Promise<ApiResult<'getPhoneInvite'>> {
    return this.call(
      this.http.get<ApiResult<'getPhoneInvite'>>(
        this.production(productionId, '/pairing/phone-invite'),
      ),
    );
  }

  /** `POST …/pairing/phone-invite/renew`: "Create new code". */
  renewPhoneInvite(productionId: string): Promise<ApiResult<'renewPhoneInvite'>> {
    return this.post<ApiResult<'renewPhoneInvite'>>(
      this.production(productionId, '/pairing/phone-invite/renew'),
    );
  }

  /** `POST …/pairing/invites`: invite link for laptops. */
  createInvite(
    productionId: string,
    body: ApiBody<'createInvite'>,
  ): Promise<ApiResult<'createInvite'>> {
    return this.post<ApiResult<'createInvite'>>(
      this.production(productionId, '/pairing/invites'),
      body,
    );
  }

  /** `DELETE …/pairing/invites/{inviteId}`: "Revoke link". */
  revokeInvite(productionId: string, inviteId: string): Promise<void> {
    return this.call(
      this.http.delete<void>(this.production(productionId, `/pairing/invites/${enc(inviteId)}`)),
    );
  }

  /** `POST …/pairing/requests/{requestId}/approve`: "Allow"; 410 when the knock expired. */
  approvePairingRequest(
    productionId: string,
    requestId: string,
  ): Promise<ApiResult<'approvePairingRequest'>> {
    return this.post<ApiResult<'approvePairingRequest'>>(
      this.production(productionId, `/pairing/requests/${enc(requestId)}/approve`),
    );
  }

  /** `POST …/pairing/requests/{requestId}/deny`: "Deny". */
  denyPairingRequest(productionId: string, requestId: string): Promise<void> {
    return this.post<void>(
      this.production(productionId, `/pairing/requests/${enc(requestId)}/deny`),
    );
  }

  // ---------------------------------------------------------------- Assets

  /** `GET …/assets`. */
  listAssets(productionId: string): Promise<ApiResult<'listAssets'>> {
    return this.call(
      this.http.get<ApiResult<'listAssets'>>(this.production(productionId, '/assets')),
    );
  }

  /**
   * `POST …/assets` (multipart field `file`) with upload progress. Uses XMLHttpRequest because the default Fetch
   * backend of HttpClient cannot report upload progress; sets the CSRF header itself. The interceptors do not run, so
   * the caller handles a 401 (`AssetUploadService` sends the operator to the login page). Rejects with an
   * {@link ApiError}: 401 signed out, 413 too large, 415 type not allowed, `aborted` when `signal` fires.
   */
  uploadAsset(
    productionId: string,
    file: File,
    options: UploadOptions = {},
  ): Promise<ApiResult<'uploadAsset'>> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new ApiError({ status: 0, code: 'aborted' }));
        return;
      }
      const xhr = this.xhrFactory();
      const abort = (): void => xhr.abort();
      const cleanup = (): void => options.signal?.removeEventListener('abort', abort);
      xhr.open('POST', this.production(productionId, '/assets'));
      xhr.setRequestHeader(CSRF_HEADER, CSRF_HEADER_VALUE);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event: ProgressEvent) => {
        const total = event.lengthComputable ? event.total : null;
        options.onProgress?.({
          loaded: event.loaded,
          total,
          fraction: total ? Math.min(1, event.loaded / total) : null,
        });
      };
      xhr.onload = () => {
        cleanup();
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as ApiResult<'uploadAsset'>);
          } catch {
            reject(new ApiError({ status: xhr.status, code: 'internal_error' }));
          }
          return;
        }
        reject(
          ApiError.fromResponse(xhr.status, xhr.responseText, xhr.getResponseHeader('Retry-After')),
        );
      };
      xhr.onerror = () => {
        cleanup();
        reject(new ApiError({ status: 0, code: 'network' }));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new ApiError({ status: 0, code: 'aborted' }));
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      const form = new FormData();
      form.append('file', file, file.name);
      xhr.send(form);
    });
  }

  /** `PATCH …/assets/{assetId}`: rename. */
  renameAsset(
    productionId: string,
    assetId: string,
    body: ApiBody<'renameAsset'>,
  ): Promise<ApiResult<'renameAsset'>> {
    return this.call(
      this.http.patch<ApiResult<'renameAsset'>>(
        this.production(productionId, `/assets/${enc(assetId)}`),
        body,
      ),
    );
  }

  /** `DELETE …/assets/{assetId}`; 409 `asset_in_use` while a scene, slate or fallback uses it. */
  deleteAsset(productionId: string, assetId: string): Promise<void> {
    return this.call(
      this.http.delete<void>(this.production(productionId, `/assets/${enc(assetId)}`)),
    );
  }

  /** URL of an asset's content (`GET …/assets/{assetId}/content`, admin cookie); no request is made. */
  assetContentUrl(productionId: string, assetId: string): string {
    return this.production(productionId, `/assets/${enc(assetId)}/content`);
  }

  // ---------------------------------------------------------------- Texts

  /** `POST …/texts`: a new text or lower third; 409 `limit_reached` at 64 texts. */
  createText(productionId: string, body: ApiBody<'createText'>): Promise<ApiResult<'createText'>> {
    return this.post<ApiResult<'createText'>>(this.production(productionId, '/texts'), body);
  }

  /** `PUT …/texts/{textId}`: replaces the content; every scene that shows the text changes. */
  updateText(
    productionId: string,
    textId: string,
    body: ApiBody<'updateText'>,
  ): Promise<ApiResult<'updateText'>> {
    return this.call(
      this.http.put<ApiResult<'updateText'>>(
        this.production(productionId, `/texts/${enc(textId)}`),
        body,
      ),
    );
  }

  /** `DELETE …/texts/{textId}`: deletes the text and removes it from every scene. */
  deleteText(productionId: string, textId: string): Promise<void> {
    return this.call(
      this.http.delete<void>(this.production(productionId, `/texts/${enc(textId)}`)),
    );
  }

  // ---------------------------------------------------------------- Output

  /** `GET …/output`: the output links with their URLs, the limit and the frame ancestors. */
  getOutputSettings(productionId: string): Promise<ApiResult<'getOutputSettings'>> {
    return this.call(
      this.http.get<ApiResult<'getOutputSettings'>>(this.production(productionId, '/output')),
    );
  }

  /** `POST …/output/links`: a named link with its own key; 409 `limit_reached` at the limit. */
  createOutputLink(
    productionId: string,
    body: ApiBody<'createOutputLink'>,
  ): Promise<ApiResult<'createOutputLink'>> {
    return this.post<ApiResult<'createOutputLink'>>(
      this.production(productionId, '/output/links'),
      body,
    );
  }

  /** `PATCH …/output/links/{linkId}`: rename; the key stays. */
  renameOutputLink(
    productionId: string,
    linkId: string,
    body: ApiBody<'renameOutputLink'>,
  ): Promise<ApiResult<'renameOutputLink'>> {
    return this.call(
      this.http.patch<ApiResult<'renameOutputLink'>>(
        this.production(productionId, `/output/links/${enc(linkId)}`),
        body,
      ),
    );
  }

  /** `PUT …/output/links/{linkId}/access`: IP restriction of the link (empty list = every address). */
  updateOutputLinkAccess(
    productionId: string,
    linkId: string,
    body: ApiBody<'updateOutputLinkAccess'>,
  ): Promise<ApiResult<'updateOutputLinkAccess'>> {
    return this.call(
      this.http.put<ApiResult<'updateOutputLinkAccess'>>(
        this.production(productionId, `/output/links/${enc(linkId)}/access`),
        body,
      ),
    );
  }

  /** `POST …/output/links/{linkId}/regenerate-key`: the old URL of this link stops immediately. */
  regenerateOutputLinkKey(
    productionId: string,
    linkId: string,
  ): Promise<ApiResult<'regenerateOutputLinkKey'>> {
    return this.post<ApiResult<'regenerateOutputLinkKey'>>(
      this.production(productionId, `/output/links/${enc(linkId)}/regenerate-key`),
    );
  }

  /** `DELETE …/output/links/{linkId}`: revokes the link; its pages are disconnected. */
  revokeOutputLink(productionId: string, linkId: string): Promise<void> {
    return this.call(
      this.http.delete<void>(this.production(productionId, `/output/links/${enc(linkId)}`)),
    );
  }

  // ---------------------------------------------------------------- Audit log

  /** `GET /api/audit`: a page of the audit log, newest first; pass `nextCursor` as `cursor` for the next page. 400 for an invalid filter. */
  listAuditLog(query: AuditQuery): Promise<ApiResult<'listAuditLog'>> {
    return this.call(
      this.http.get<ApiResult<'listAuditLog'>>('/api/audit', { params: queryParams(query) }),
    );
  }

  /**
   * `GET /api/audit/export.csv|json`: the filtered entries as text. The file name comes from the server; 409
   * `limit_reached` when the filter matches too many entries, 429 for too many exports.
   */
  async exportAuditLog(format: 'csv' | 'json', query: AuditExportQuery): Promise<AuditExport> {
    const response = await this.call(
      this.http.get(`/api/audit/export.${format}`, {
        params: queryParams(query),
        responseType: 'text',
        observe: 'response',
      }),
    );
    const fileName = /filename="?([^";]+)"?/.exec(
      response.headers.get('Content-Disposition') ?? '',
    )?.[1];
    return { text: response.body ?? '', fileName: fileName ?? `studioflow-audit.${format}` };
  }

  // ---------------------------------------------------------------- Helpers

  private production(productionId: string, suffix = ''): string {
    return `/api/productions/${enc(productionId)}${suffix}`;
  }

  private scene(productionId: string, sceneId: string, suffix = ''): string {
    return this.production(productionId, `/scenes/${enc(sceneId)}${suffix}`);
  }

  private device(productionId: string, deviceId: string, suffix = ''): string {
    return this.production(productionId, `/devices/${enc(deviceId)}${suffix}`);
  }

  private post<T>(url: string, body: unknown = null): Promise<T> {
    return this.call(this.http.post<T>(url, body));
  }

  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request, { defaultValue: undefined as T });
    } catch (error) {
      throw ApiError.from(error);
    }
  }
}
