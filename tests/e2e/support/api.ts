import type {
  AddSceneItemRequest,
  AllocateSlotRequest,
  AssetDto,
  BandwidthTestResultDto,
  CreateInviteRequest,
  CreatePairingRequest,
  CreateProductionRequest,
  CreateSceneRequest,
  DeviceCommandDto,
  DeviceCommandRequest,
  DeviceCredentialsDto,
  DeviceDto,
  DeviceReportDto,
  DeviceSelfDto,
  DeviceSessionDto,
  DeviceSlotDto,
  DeviceTelemetryMessage,
  InviteDto,
  LiveKitTokenDto,
  OutputReport,
  OutputSettingsDto,
  OutputSnapshot,
  PairingRequestCreatedDto,
  PairingRequestStatusDto,
  ProductionChangesDto,
  ProductionDto,
  ProductionSnapshot,
  ProductionSummaryDto,
  RedeemInviteRequest,
  ReorderScenesRequest,
  ReplaceSceneItemsRequest,
  SceneDto,
  SceneItemDto,
  SessionDto,
  SetPreviewRequest,
  SwitchProgramRequest,
  SystemInfoDto,
  TakeRequest,
  UpdateOutputAccessRequest,
  UpdateProductionRequest,
  UpdateSceneRequest,
  TransitionDto,
} from '../../../packages/scene-model/src/contracts';
import { multipart, send, type HttpResponse } from './http';
import { stackConfig } from './env';

export type {
  AssetDto,
  DeviceCredentialsDto,
  DeviceDto,
  InviteDto,
  OutputSettingsDto,
  ProductionDto,
  ProductionSnapshot,
  SceneDto,
  SceneItemDto,
};

/** A response with the body parsed as JSON where the server sent JSON. */
export interface ApiResult<T> {
  status: number;
  /** Parsed JSON (undefined for empty or non-JSON bodies). */
  body: T;
  headers: Record<string, string>;
  raw: HttpResponse;
}

/** ProblemDetails fields (the HTTP status is on the result itself). */
export interface Problem {
  type?: string;
  title?: string;
  detail?: string;
  code?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}

/** The generated request types list every field as required; tests send partial bodies on purpose. */
export type Loose<T> = { [K in keyof T]?: T[K] };

export const CUT: TransitionDto = { kind: 'cut', durationMs: 0 };
export const FADE_300: TransitionDto = { kind: 'fade', durationMs: 300 };

function wrap<T>(raw: HttpResponse): ApiResult<T> {
  let body: unknown;
  const type = raw.headers['content-type'] ?? '';
  if (raw.body.length > 0 && /json/i.test(type)) {
    try {
      body = raw.json();
    } catch {
      body = undefined;
    }
  }
  return { status: raw.status, body: body as T, headers: raw.headers, raw };
}

export interface CallOptions {
  json?: unknown;
  body?: Buffer | string;
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | number | undefined>;
  /** Do not send the X-StudioFlow header on unsafe requests. */
  noCsrf?: boolean;
  /** Do not send the credential (cookie/bearer) of this client. */
  anonymous?: boolean;
  timeoutMs?: number;
  headersOnly?: boolean;
}

/** Shared plumbing of the clients below. */
export class HttpApi {
  constructor(public readonly base: string) {}

  /** Credential headers of this client; overridden by the subclasses. */
  protected defaultHeaders(): Record<string, string> {
    return {};
  }

  async call<T = unknown>(method: string, route: string, options: CallOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string | undefined> = options.anonymous ? {} : { ...this.defaultHeaders() };
    if (options.noCsrf) delete headers['X-StudioFlow'];
    Object.assign(headers, options.headers);
    let url = `${this.base}${route}`;
    if (options.query) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(options.query)) if (value !== undefined) query.set(key, String(value));
      url += `${route.includes('?') ? '&' : '?'}${query.toString()}`;
    }
    const raw = await send({ method, url, headers, json: options.json, body: options.body, timeoutMs: options.timeoutMs, headersOnly: options.headersOnly });
    return wrap<T>(raw);
  }
}

/** The admin API (cookie + CSRF header), named after the operation ids of ApiSurface.cs. */
export class AdminApi extends HttpApi {
  constructor(
    base: string,
    public cookie = '',
    /** Value of X-Forwarded-For sent with every request (only honoured on the direct API port). */
    public forwardedFor?: string,
  ) {
    super(base);
  }

  protected override defaultHeaders(): Record<string, string> {
    return {
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      'X-StudioFlow': '1',
      ...(this.forwardedFor ? { 'X-Forwarded-For': this.forwardedFor } : {}),
    };
  }

  static async login(base = stackConfig().baseURL, credentials = stackConfig().admin, forwardedFor?: string): Promise<AdminApi> {
    const api = new AdminApi(base, '', forwardedFor);
    const response = await api.login(credentials.username, credentials.password);
    if (response.status !== 200) throw new Error(`admin login failed: ${response.status} ${response.raw.text().slice(0, 200)}`);
    return api;
  }

  /** A client with the same session for another base URL (e.g. the direct API port). */
  withBase(base: string, forwardedFor?: string): AdminApi {
    return new AdminApi(base, this.cookie, forwardedFor);
  }

  // --- auth -------------------------------------------------------------------------------------------------------
  async login(username: string, password: string): Promise<ApiResult<SessionDto & Problem>> {
    const result = await this.call<SessionDto & Problem>('POST', '/api/auth/login', { json: { username, password }, anonymous: true, headers: this.forwardedFor ? { 'X-Forwarded-For': this.forwardedFor } : {} });
    const cookie = result.raw.setCookies.map((value) => value.split(';')[0]!).find((value) => value.startsWith('sf_session='));
    if (result.status === 200 && cookie) this.cookie = cookie;
    return result;
  }
  logout = () => this.call<void>('POST', '/api/auth/logout');
  getSession = () => this.call<SessionDto & Problem>('GET', '/api/auth/me');
  getSystemInfo = () => this.call<SystemInfoDto>('GET', '/api/system/info');

  // --- productions ------------------------------------------------------------------------------------------------
  listProductions = () => this.call<ProductionSummaryDto[]>('GET', '/api/productions/');
  createProduction = (body: CreateProductionRequest) => this.call<ProductionDto & Problem>('POST', '/api/productions/', { json: body });
  getActiveProduction = () => this.call<ProductionSummaryDto & Problem>('GET', '/api/productions/active');
  getSnapshot = (id: string) => this.call<ProductionSnapshot & Problem>('GET', `/api/productions/${id}/snapshot`);
  getChanges = (id: string, since?: number | string) => this.call<ProductionChangesDto & Problem>('GET', `/api/productions/${id}/changes`, { query: { since } });
  updateProduction = (id: string, body: Loose<UpdateProductionRequest>) => this.call<ProductionDto & Problem>('PATCH', `/api/productions/${id}`, { json: body });
  activateProduction = (id: string) => this.call<ProductionDto & Problem>('POST', `/api/productions/${id}/activate`);
  startBroadcast = (id: string) => this.call<ProductionDto & Problem>('POST', `/api/productions/${id}/broadcast/start`);
  endBroadcast = (id: string) => this.call<ProductionDto & Problem>('POST', `/api/productions/${id}/broadcast/end`);
  resetBroadcast = (id: string) => this.call<ProductionDto & Problem>('POST', `/api/productions/${id}/broadcast/reset`);
  setPreview = (id: string, body: SetPreviewRequest) => this.call<ProductionDto & Problem>('PUT', `/api/productions/${id}/preview`, { json: body });
  switchProgram = (id: string, body: SwitchProgramRequest) => this.call<ProductionDto & Problem>('POST', `/api/productions/${id}/program`, { json: body });
  take = (id: string, body: TakeRequest = { transition: CUT }) => this.call<ProductionDto & Problem>('POST', `/api/productions/${id}/take`, { json: body });
  acknowledgeIncident = (id: string, incidentId: string) => this.call<Problem>('POST', `/api/productions/${id}/incidents/${incidentId}/ack`);
  getStudioLiveKitToken = (id: string) => this.call<LiveKitTokenDto & Problem>('POST', `/api/productions/${id}/livekit-token`);
  getTelemetry = (id: string) => this.call<DeviceTelemetryMessage[] & Problem>('GET', `/api/productions/${id}/telemetry`);

  // --- scenes -----------------------------------------------------------------------------------------------------
  createScene = (id: string, body: Loose<CreateSceneRequest>) => this.call<SceneDto & Problem>('POST', `/api/productions/${id}/scenes/`, { json: body });
  updateScene = (id: string, sceneId: string, body: Loose<UpdateSceneRequest>) => this.call<SceneDto & Problem>('PATCH', `/api/productions/${id}/scenes/${sceneId}`, { json: body });
  deleteScene = (id: string, sceneId: string) => this.call<Problem>('DELETE', `/api/productions/${id}/scenes/${sceneId}`);
  reorderScenes = (id: string, body: ReorderScenesRequest) => this.call<Problem>('PUT', `/api/productions/${id}/scenes/order`, { json: body });
  addSceneItem = (id: string, sceneId: string, body: Loose<AddSceneItemRequest> & { source: string }) => this.call<SceneDto & Problem>('POST', `/api/productions/${id}/scenes/${sceneId}/items`, { json: body });
  updateSceneItem = (id: string, sceneId: string, itemId: string, body: SceneItemDto) => this.call<SceneDto & Problem>('PUT', `/api/productions/${id}/scenes/${sceneId}/items/${itemId}`, { json: body });
  removeSceneItem = (id: string, sceneId: string, itemId: string) => this.call<SceneDto & Problem>('DELETE', `/api/productions/${id}/scenes/${sceneId}/items/${itemId}`);
  replaceSceneItems = (id: string, sceneId: string, body: Loose<ReplaceSceneItemsRequest> & { items: SceneItemDto[] }) => this.call<SceneDto & Problem>('PUT', `/api/productions/${id}/scenes/${sceneId}/items`, { json: body });

  // --- devices ----------------------------------------------------------------------------------------------------
  renameDevice = (id: string, deviceId: string, name: string) => this.call<DeviceDto & Problem>('PATCH', `/api/productions/${id}/devices/${deviceId}`, { json: { name } });
  blockDevice = (id: string, deviceId: string) => this.call<DeviceDto & Problem>('POST', `/api/productions/${id}/devices/${deviceId}/block`);
  unblockDevice = (id: string, deviceId: string) => this.call<DeviceDto & Problem>('POST', `/api/productions/${id}/devices/${deviceId}/unblock`);
  deleteDevice = (id: string, deviceId: string) => this.call<Problem>('DELETE', `/api/productions/${id}/devices/${deviceId}`);
  sendDeviceCommand = (id: string, deviceId: string, body: Loose<DeviceCommandRequest> | Record<string, unknown>) => this.call<DeviceCommandDto & Problem>('POST', `/api/productions/${id}/devices/${deviceId}/commands`, { json: body });

  // --- pairing (admin side) ---------------------------------------------------------------------------------------
  getPhoneInvite = (id: string) => this.call<InviteDto & Problem>('GET', `/api/productions/${id}/pairing/phone-invite`);
  renewPhoneInvite = (id: string) => this.call<InviteDto & Problem>('POST', `/api/productions/${id}/pairing/phone-invite/renew`);
  createInvite = (id: string, body: CreateInviteRequest) => this.call<InviteDto & Problem>('POST', `/api/productions/${id}/pairing/invites`, { json: body });
  revokeInvite = (id: string, inviteId: string) => this.call<Problem>('DELETE', `/api/productions/${id}/pairing/invites/${inviteId}`);
  approvePairingRequest = (id: string, requestId: string) => this.call<DeviceDto & Problem>('POST', `/api/productions/${id}/pairing/requests/${requestId}/approve`);
  denyPairingRequest = (id: string, requestId: string) => this.call<Problem>('POST', `/api/productions/${id}/pairing/requests/${requestId}/deny`);

  // --- assets -----------------------------------------------------------------------------------------------------
  listAssets = (id: string) => this.call<AssetDto[]>('GET', `/api/productions/${id}/assets/`);
  uploadAsset = (id: string, file: { fileName: string; contentType?: string; data: Buffer }, options: CallOptions = {}) => {
    const { body, contentType } = multipart([{ name: 'file', fileName: file.fileName, contentType: file.contentType, data: file.data }]);
    return this.call<AssetDto & Problem>('POST', `/api/productions/${id}/assets/`, { ...options, body, headers: { 'Content-Type': contentType, ...options.headers } });
  };
  renameAsset = (id: string, assetId: string, name: string) => this.call<AssetDto & Problem>('PATCH', `/api/productions/${id}/assets/${assetId}`, { json: { name } });
  deleteAsset = (id: string, assetId: string) => this.call<Problem>('DELETE', `/api/productions/${id}/assets/${assetId}`);
  getAssetContent = (id: string, assetId: string, options: CallOptions & { method?: string } = {}) =>
    this.call<unknown>(options.method ?? 'GET', `/api/productions/${id}/assets/${assetId}/content`, options);

  // --- output (admin side) ----------------------------------------------------------------------------------------
  getOutputSettings = (id: string) => this.call<OutputSettingsDto & Problem>('GET', `/api/productions/${id}/output/`);
  updateOutputAccess = (id: string, body: UpdateOutputAccessRequest) => this.call<OutputSettingsDto & Problem>('PUT', `/api/productions/${id}/output/access`, { json: body });
  regenerateOutputKey = (id: string) => this.call<OutputSettingsDto & Problem>('POST', `/api/productions/${id}/output/regenerate-key`);
}

/** Anonymous pairing routes. */
export class PublicApi extends HttpApi {
  constructor(base = stackConfig().baseURL, public forwardedFor?: string) {
    super(base);
  }

  protected override defaultHeaders(): Record<string, string> {
    return this.forwardedFor ? { 'X-Forwarded-For': this.forwardedFor } : {};
  }
  createPairingRequest = (body: CreatePairingRequest | Record<string, unknown>) => this.call<PairingRequestCreatedDto & Problem>('POST', '/api/pairing/requests', { json: body });
  getPairingRequestStatus = (requestId: string, pollToken?: string) =>
    this.call<PairingRequestStatusDto & Problem>('GET', `/api/pairing/requests/${requestId}`, { headers: pollToken === undefined ? {} : { 'X-Pairing-Token': pollToken } });
  cancelPairingRequest = (requestId: string, pollToken?: string) =>
    this.call<Problem>('DELETE', `/api/pairing/requests/${requestId}`, { headers: pollToken === undefined ? {} : { 'X-Pairing-Token': pollToken } });
  redeemInvite = (token: string, body: RedeemInviteRequest | Record<string, unknown>) =>
    this.call<DeviceCredentialsDto & Problem>('POST', `/api/pairing/invites/${encodeURIComponent(token)}/redeem`, { json: body });
}

/** `Authorization: Bearer {deviceId}.{secret}` routes of the sender. */
export class DeviceApi extends HttpApi {
  constructor(
    base: string,
    public credentials: DeviceCredentialsDto,
    public forwardedFor?: string,
  ) {
    super(base);
  }

  protected override defaultHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.credentials.deviceId}.${this.credentials.deviceSecret}`,
      ...(this.forwardedFor ? { 'X-Forwarded-For': this.forwardedFor } : {}),
    };
  }
  get bearer(): string {
    return `${this.credentials.deviceId}.${this.credentials.deviceSecret}`;
  }
  getDeviceSelf = () => this.call<DeviceSelfDto & Problem>('GET', '/api/device/me');
  getDeviceSession = () => this.call<DeviceSessionDto & Problem>('GET', '/api/device/session');
  getDeviceLiveKitToken = () => this.call<LiveKitTokenDto & Problem>('POST', '/api/device/livekit-token');
  allocateSlot = (body: AllocateSlotRequest | Record<string, unknown>) => this.call<DeviceSlotDto & Problem>('POST', '/api/device/slots', { json: body });
  releaseSlot = (slot: string) => this.call<Problem>('DELETE', `/api/device/slots/${slot}`);
  reportDeviceStatus = (body: DeviceReportDto | Record<string, unknown>) => this.call<Problem>('POST', '/api/device/report', { json: body });
  bandwidthTest = (data: Buffer) => this.call<BandwidthTestResultDto & Problem>('POST', '/api/device/bandwidth-test', { body: data, headers: { 'Content-Type': 'application/octet-stream' } });
  unpairDevice = () => this.call<Problem>('POST', '/api/device/unpair');
}

/** `X-Output-Key` routes of the output page. */
export class OutputApi extends HttpApi {
  constructor(
    base: string,
    public slug: string,
    public key: string | undefined,
    public forwardedFor?: string,
  ) {
    super(base);
  }

  protected override defaultHeaders(): Record<string, string> {
    return {
      ...(this.key !== undefined ? { 'X-Output-Key': this.key } : {}),
      ...(this.forwardedFor ? { 'X-Forwarded-For': this.forwardedFor } : {}),
    };
  }
  getOutputSnapshot = () => this.call<OutputSnapshot & Problem>('GET', `/api/output/${this.slug}/snapshot`);
  getOutputLiveKitToken = () => this.call<LiveKitTokenDto & Problem>('POST', `/api/output/${this.slug}/livekit-token`);
  reportOutputStatus = (body: OutputReport | Record<string, unknown>) => this.call<Problem>('POST', `/api/output/${this.slug}/report`, { json: body });
}

/** Splits an output URL ({base}/o/{slug}?k={key}) into slug and key. */
export function parseOutputUrl(url: string): { slug: string; key: string } {
  const parsed = new URL(url);
  const slug = decodeURIComponent(parsed.pathname.replace(/^\/o\//, ''));
  return { slug, key: parsed.searchParams.get('k') ?? '' };
}

/** Last path segment of an invite URL (the secret token). */
export function inviteToken(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
}
