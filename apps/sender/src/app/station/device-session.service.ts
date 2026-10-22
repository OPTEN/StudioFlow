import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  isTerminalState,
  toRtcState,
  type LocalSlotState,
  type MediaSessionState,
} from '@flowstudio/media-client';
import { backoffDelay, type HubState } from '@flowstudio/realtime-client';
import {
  HUB,
  screenSlot,
  slotKind,
  type DeviceCommandDto,
  type DeviceKind,
  type DeviceReportDto,
  type DeviceSelfDto,
  type DeviceSessionDto,
  type DeviceSlotDto,
  type TallyDto,
  type TallyState,
  type TechCheckDto,
} from '@flowstudio/scene-model';
import { toApiError, type ApiError } from '../core/api-error';
import { APP_VERSION } from '../core/app-version';
import { CredentialsService } from '../core/credentials.service';
import { DeviceApiService } from '../core/device-api.service';
import { DEVICE_ENVIRONMENT } from '../core/device-environment';
import { LiveStateService } from '../core/live-state.service';
import { NetworkStatusService } from '../core/network-status.service';
import { NoticeService } from '../core/notice.service';
import { createSessionId } from '../core/random-id';
import {
  SenderSettingsService,
  type Facing,
  type Resolution,
} from '../core/sender-settings.service';
import { buildDeviceReport, type SyntheticSlotState } from './device-report';
import {
  OFF_TALLY,
  isBlockedHubError,
  isDeviceSelf,
  parseCommand,
  parseTally,
  slotNumber,
} from './device-messages';
import {
  DEVICE_HUB_FACTORY,
  SENDER_MEDIA_FACTORY,
  TECH_CHECK_RUNNER,
  WAKE_LOCK_FACTORY,
  type DeviceHub,
  type SenderMedia,
  type StationWakeLock,
} from './station-ports';

/** Report cadence (spec 6). */
export const REPORT_INTERVAL_MS = 2000;
/** RTT probe and self refresh via `GET /api/device/me`. */
export const RTT_INTERVAL_MS = 10_000;
/** Status check while blocked (spec 4.6). */
export const BLOCKED_RETRY_MS = 15_000;
/** Pause before reconnecting after a refused connection when `GET /me` says access is fine (or failed). */
export const ACCESS_RETRY_MS = 5000;
/** A Regie message disappears after this time unless confirmed earlier. */
export const MESSAGE_DISMISS_MS = 15_000;
/** The first technical check waits this long for the phone camera before it runs without it. */
export const TECH_CHECK_CAMERA_WAIT_MS = 8000;

/**
 * Lifecycle of the station:
 * `idle` not started · `connecting` hub/media connecting, no Hello answer yet · `online` Hello answered ·
 * `blocked` the Regie blocked the device («Dieses Gerät ist gesperrt», retried every 15 s) · `replaced` another tab
 * took over («In einem anderen Tab geöffnet») · `removed` credentials invalid (back to pairing) · `stopped` left.
 */
export type StationPhase =
  'idle' | 'connecting' | 'online' | 'blocked' | 'replaced' | 'removed' | 'stopped';

/** What the connection line shows (`data-state` of `[data-testid=connection-state]`). */
export type ConnectionView =
  'connecting' | 'connected' | 'reconnecting' | 'offline' | 'blocked' | 'replaced' | 'removed';

/** State of one slot as shown on the station. */
export interface SlotView {
  readonly state: LocalSlotState;
  /** German explanation (failure, cancelled or ended share). */
  readonly message: string | null;
}

/** A slot of this device with everything the UI needs. */
export interface StationSlot extends SlotView {
  readonly slot: string;
  /** Slot code (K3, S2); null while a new screen is still being allocated. */
  readonly code: string | null;
  readonly kind: 'camera' | 'screen';
  readonly tally: TallyState;
  /** The Regie asked to share this screen again. */
  readonly reshareRequested: boolean;
}

/** A message from the Regie (Regie-Chat). */
export interface RegieMessage {
  readonly id: string;
  readonly text: string;
  readonly at: Date;
}

const TERMINAL_PHASES: ReadonlySet<StationPhase> = new Set([
  'blocked',
  'replaced',
  'removed',
  'stopped',
]);
const SENDING: ReadonlySet<LocalSlotState> = new Set(['starting', 'live', 'paused']);
const IDLE_VIEW: SlotView = { state: 'idle', message: null };
const CANCELLED_MESSAGE = 'Freigabe abgebrochen';

/** View of a slot: the publisher's state, else the synthetic one (stopped on purpose, lost by a reload). */
function viewOf(live: SlotView | undefined, synthetic: SyntheticSlotState | undefined): SlotView {
  if (live !== undefined && live.state !== 'idle') {
    return live;
  }
  if (synthetic === 'ended') {
    return { state: 'ended', message: live?.message ?? 'Freigabe beendet' };
  }
  // A camera stopped on purpose is reported as `paused` but shown as off.
  return synthetic === 'paused' ? IDLE_VIEW : (live ?? IDLE_VIEW);
}

/**
 * The paired station (spec 4.6, 6, 7, 9.2): device hub (`ResilientHub`, Hello with a per-tab session id, `tally`,
 * `command`, `self`, `sessionReplaced`, report every 2 s), LiveKit session and publisher, wake lock, technical check,
 * and the state machine for blocked devices, replaced sessions and removed devices.
 *
 * Provided per station screen; all state is in signals, written from hub and media callbacks (zoneless).
 */
@Injectable()
export class DeviceSessionService {
  private readonly api = inject(DeviceApiService);
  private readonly credentials = inject(CredentialsService);
  private readonly settingsService = inject(SenderSettingsService);
  private readonly env = inject(DEVICE_ENVIRONMENT);
  private readonly liveState = inject(LiveStateService);
  private readonly network = inject(NetworkStatusService);
  private readonly notices = inject(NoticeService);
  private readonly document = inject(DOCUMENT);
  private readonly hubFactory = inject(DEVICE_HUB_FACTORY);
  private readonly mediaFactory = inject(SENDER_MEDIA_FACTORY);
  private readonly wakeLockFactory = inject(WAKE_LOCK_FACTORY);
  private readonly techCheckRunner = inject(TECH_CHECK_RUNNER);

  /** Id of this tab for `Hello`; a reload starts a new session, a «Hier weitermachen» keeps it. */
  readonly sessionId = createSessionId();

  readonly phase = signal<StationPhase>('idle');
  readonly hubState = signal<HubState>('idle');
  readonly mediaState = signal<MediaSessionState>('idle');
  readonly connection = signal<ConnectionView>('connecting');
  /** Start of the current outage (for «Verbindet neu … 00:12»), null while connected. */
  readonly degradedSince = signal<number | null>(null);
  /** Ticks every second (timers in the UI). */
  readonly now = signal(Date.now());
  /** The last `GET /api/device/me` failed without an answer. */
  readonly serverUnreachable = signal(false);
  readonly self = signal<DeviceSelfDto | null>(null);
  readonly tally = signal<TallyDto>(OFF_TALLY);
  readonly message = signal<RegieMessage | null>(null);
  readonly reshareRequests = signal<ReadonlySet<string>>(new Set());
  readonly techCheck = signal<TechCheckDto | null>(null);
  readonly techCheckRunning = signal(false);
  readonly rttMs = signal<number | null>(null);
  /** German error of the last user action (allocating a screen, removing a slot …). */
  readonly actionError = signal<string | null>(null);
  /** Bumped whenever a local preview stream may have changed. */
  readonly previewRevision = signal(0);

  private readonly slotStates = signal<Readonly<Record<string, SlotView>>>({});
  /** Slots stopped on purpose or lost by a reload (see {@link buildDeviceReport}). */
  private readonly synthetic = signal<ReadonlyMap<string, SyntheticSlotState>>(new Map());
  /** Screens added in this page whose allocation is still running. */
  private readonly pendingScreens = signal<ReadonlySet<string>>(new Set());

  /** Device kind (null until known). */
  readonly kind = computed<DeviceKind | null>(() => this.self()?.kind ?? null);
  /** Current camera settings. */
  readonly settings = this.settingsService.settings;
  /** Camera direction in use or to be used. */
  readonly facing = computed<Facing>(
    () =>
      this.settingsService.settings().facing ?? (this.kind() === 'laptop' ? 'user' : 'environment'),
  );

  /** All slots of the device (camera first, then screens by number), including screens being added. */
  readonly slots = computed<readonly StationSlot[]>(() => {
    const self = this.self();
    const states = this.slotStates();
    const synthetic = this.synthetic();
    const tally = this.tally();
    const reshare = this.reshareRequests();
    const known: DeviceSlotDto[] = [...(self?.slots ?? [])];
    for (const slot of this.pendingScreens()) {
      if (!known.some((entry) => entry.slot === slot)) {
        known.push({ slot, code: '', kind: 'screen' });
      }
    }
    return known
      .filter((entry) => entry.kind === 'camera' || entry.kind === 'screen')
      .sort((a, b) => slotNumber(a.slot) - slotNumber(b.slot))
      .map((entry): StationSlot => ({
        ...viewOf(states[entry.slot], synthetic.get(entry.slot)),
        slot: entry.slot,
        code: entry.code === '' ? null : entry.code,
        kind: entry.kind === 'camera' ? 'camera' : 'screen',
        tally: tally.slots[entry.slot] ?? 'off',
        reshareRequested: reshare.has(entry.slot),
      }));
  });

  /** The camera slot, if the device has one. */
  readonly camera = computed(() => this.slots().find((slot) => slot.kind === 'camera') ?? null);
  /** The screen slots. */
  readonly screens = computed(() => this.slots().filter((slot) => slot.kind === 'screen'));
  /** Something is being captured or published. */
  readonly sending = computed(() => this.slots().some((slot) => SENDING.has(slot.state)));

  private hub: DeviceHub | null = null;
  private media: SenderMedia | null = null;
  private wakeLock: StationWakeLock | null = null;
  private readonly disposers: (() => unknown)[] = [];
  private readonly intervals: ReturnType<typeof setInterval>[] = [];
  private accessTimer: ReturnType<typeof setTimeout> | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  private techCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private helloAttempt = 0;
  private helloFailures = 0;
  private everOnline = false;
  private verifying = false;
  private probing = false;
  private reporting = false;
  private autoStartDone = false;
  private firstCheckPending = false;
  /** Screens allocated in this page that never went live: released again when their picker is cancelled. */
  private readonly freshScreens = new Set<string>();
  /** Fresh screens whose picker was cancelled while the allocation was still running. */
  private readonly cancelledScreens = new Set<string>();
  /** Last report sent (tests, diagnostics). */
  private lastReportSent: DeviceReportDto | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.shutdown());
  }

  /** The last report sent over the hub. */
  get lastReport(): DeviceReportDto | null {
    return this.lastReportSent;
  }

  /** Starts hub, media, reports and probes. Without credentials the phase becomes `removed`. */
  start(): void {
    if (this.phase() !== 'idle') {
      return;
    }
    if (this.credentials.credentials() === null) {
      this.phase.set('removed');
      return;
    }
    const hub = this.hubFactory({
      url: HUB.devicePath,
      accessTokenFactory: () => this.credentials.bearer() ?? '',
    });
    const media = this.mediaFactory(() => this.api.getLiveKitToken());
    this.hub = hub;
    this.media = media;
    this.wakeLock = this.wakeLockFactory();
    this.disposers.push(
      hub.onStateChange((state) => this.onHubState(state)),
      hub.onConnected(() => void this.sayHello()),
      hub.on(HUB.tally, (tally: unknown) => this.onTally(tally)),
      hub.on(HUB.command, (command: unknown) => this.onCommand(command)),
      hub.on(HUB.self, (self: unknown) => this.onSelf(self)),
      hub.on(HUB.sessionReplaced, () => this.enterReplaced()),
      media.session.onStateChange((state) => this.onMediaState(state)),
      media.publisher.onSlotState((slot, state, message) => this.onSlotState(slot, state, message)),
      this.network.onWake(() => this.onWake()),
      this.network.onOnlineChange(() => this.refreshConnection()),
    );
    this.restoreSettings();
    this.phase.set('connecting');
    this.refreshConnection();
    hub.start();
    media.session.start();
    this.intervals.push(
      setInterval(() => void this.sendReport(), REPORT_INTERVAL_MS),
      setInterval(() => void this.probeSelf(), RTT_INTERVAL_MS),
      setInterval(() => this.now.set(Date.now()), 1000),
    );
    void this.probeSelf();
    this.installTestHook();
  }

  /** «Hier weitermachen»: takes the session back from the other tab. */
  takeOver(): void {
    if (this.phase() !== 'replaced') {
      return;
    }
    this.phase.set('connecting');
    this.hub?.restart();
    this.media?.session.restart();
    this.refreshConnection();
    this.updateDerived();
  }

  // ---- Camera -------------------------------------------------------------------------------------------------

  /** Starts (or retries) the camera with the stored settings. */
  startCamera(): void {
    const media = this.media;
    if (media === null || this.isTerminal()) {
      return;
    }
    const facing = this.facing();
    const resolution = this.settingsService.settings().resolution;
    this.setSynthetic('camera', null);
    this.settingsService.update({ cameraOn: true, facing });
    this.autoStartDone = true;
    void media.publisher.publishCamera('camera', { facingMode: facing, resolution });
  }

  /** Stops the camera on purpose (reported as `paused`, the Regie sees it as ended). */
  stopCamera(): void {
    const media = this.media;
    if (media === null) {
      return;
    }
    this.setSynthetic('camera', 'paused');
    this.settingsService.update({ cameraOn: false });
    void media.publisher.unpublish('camera');
  }

  /** Front or back camera; applied to the running camera without a new publication. */
  setFacing(facing: Facing): void {
    if (facing === this.facing()) {
      return;
    }
    this.settingsService.update({ facing });
    if (this.media !== null && SENDING.has(this.media.publisher.slotState('camera'))) {
      void this.media.publisher.switchCamera();
    }
  }

  /** Toggles front/back (also the Regie's `switchCamera` command). */
  toggleFacing(): void {
    this.setFacing(this.facing() === 'user' ? 'environment' : 'user');
  }

  /** 720p or 1080p; applied to the running camera in place. */
  setResolution(resolution: Resolution): void {
    if (resolution === this.settingsService.settings().resolution) {
      return;
    }
    this.settingsService.update({ resolution });
    if (this.media !== null && SENDING.has(this.media.publisher.slotState('camera'))) {
      void this.media.publisher.setCameraResolution(resolution);
    }
  }

  /** «Dunkel» on or off. */
  setDark(dark: boolean): void {
    this.settingsService.update({ dark });
  }

  /** Laptop: allocates the optional camera slot (once) and starts it. */
  async addCamera(): Promise<void> {
    if (this.camera() !== null) {
      this.startCamera();
      return;
    }
    this.actionError.set(null);
    try {
      const slot = await this.api.allocateSlot('camera');
      this.addSlotToSelf(slot);
      this.startCamera();
    } catch (error) {
      this.actionError.set(this.actionMessage(error));
    }
  }

  // ---- Screens ------------------------------------------------------------------------------------------------

  /**
   * Shares a screen into an existing slot. Call it directly from the click handler: getDisplayMedia runs
   * synchronously inside, before anything is awaited (user gesture).
   */
  shareScreen(slot: string): void {
    const media = this.media;
    if (media === null || this.isTerminal()) {
      return;
    }
    this.actionError.set(null);
    void media.publisher.publishScreen(slot);
    this.setReshare(slot, false);
  }

  /**
   * «+ weiteren Bildschirm»: opens the browser's share dialog at once (user gesture) for the next free screen slot
   * and allocates that slot on the server meanwhile (`POST /api/device/slots`, the server takes the lowest free one).
   */
  addScreen(): void {
    const media = this.media;
    const self = this.self();
    if (media === null || self === null || this.isTerminal()) {
      return;
    }
    const used = new Set([...self.slots.map((slot) => slot.slot), ...this.pendingScreens()]);
    let slot: string | null = null;
    for (let index = 1; index <= 9 && slot === null; index++) {
      if (!used.has(screenSlot(index))) {
        slot = screenSlot(index);
      }
    }
    if (slot === null) {
      this.actionError.set('Pro Gerät sind höchstens 9 Bildschirme möglich.');
      return;
    }
    this.actionError.set(null);
    void media.publisher.publishScreen(slot);
    this.freshScreens.add(slot);
    this.pendingScreens.update((pending) => new Set([...pending, slot]));
    void this.allocateScreen(slot);
  }

  /** «Teilen beenden»: stops the share; the slot stays (the Regie sees «Teilen beendet» and can ask again). */
  endShare(slot: string): void {
    this.setSynthetic(slot, 'ended');
    void this.media?.publisher.unpublish(slot);
  }

  /** «Entfernen»: stops the slot and removes the source in the Regie (`DELETE /api/device/slots/{slot}`). */
  async removeSlot(slot: string): Promise<void> {
    void this.media?.publisher.unpublish(slot);
    this.setSynthetic(slot, null);
    this.setReshare(slot, false);
    this.forgetSharedScreen(slot);
    if (slot === 'camera') {
      this.settingsService.update({ cameraOn: false });
    }
    this.actionError.set(null);
    try {
      await this.api.releaseSlot(slot);
      this.removeSlotFromSelf(slot);
    } catch (error) {
      if (toApiError(error).status === 404) {
        // Already gone on the server (removed in another tab): the goal is reached.
        this.removeSlotFromSelf(slot);
        return;
      }
      this.actionError.set(this.actionMessage(error));
    }
  }

  // ---- Messages and technical check ---------------------------------------------------------------------------

  /** «OK» on the Regie message banner. */
  dismissMessage(): void {
    this.clearTimer('messageTimer');
    this.message.set(null);
  }

  /** Hides the reshare request of a slot without sharing. */
  dismissReshare(slot: string): void {
    this.setReshare(slot, false);
  }

  /** Runs the technical check (camera, RTT, upload) and reports the result. */
  async runTechCheck(): Promise<void> {
    if (this.techCheckRunning() || this.media === null) {
      return;
    }
    this.firstCheckPending = false;
    this.clearTimer('techCheckTimer');
    this.techCheckRunning.set(true);
    try {
      const preview = this.media.publisher.localPreview('camera');
      const result = await this.techCheckRunner({
        getUserMediaTrack: preview?.getVideoTracks()[0] ?? null,
        ping: async () => (await this.api.getSelfTimed()).rttMs,
        uploadTest: (bytes) => this.api.bandwidthTest(bytes),
      });
      this.techCheck.set(result);
      const deviceId = this.credentials.credentials()?.deviceId;
      if (deviceId !== undefined) {
        this.settingsService.update({ techCheck: { deviceId, result } });
      }
      void this.sendReport();
    } finally {
      this.techCheckRunning.set(false);
    }
  }

  /** Local camera or screen picture for the preview `<video>`. */
  preview(slot: string): MediaStream | null {
    this.previewRevision();
    return this.media?.publisher.localPreview(slot) ?? null;
  }

  // ---- Hub ----------------------------------------------------------------------------------------------------

  private onHubState(state: HubState): void {
    this.hubState.set(state);
    if (state === 'connected') {
      this.serverUnreachable.set(false);
    }
    if (state === 'unauthorized' && !this.isTerminal()) {
      void this.verifyAccess();
    }
    this.refreshConnection();
  }

  private async sayHello(): Promise<void> {
    const hub = this.hub;
    if (hub === null || this.isTerminal()) {
      return;
    }
    const attempt = ++this.helloAttempt;
    this.clearTimer('helloTimer');
    try {
      const session = await hub.invoke<DeviceSessionDto>(HUB.hello, {
        sessionId: this.sessionId,
        platform: this.env.platform(),
        appVersion: APP_VERSION,
      });
      if (attempt !== this.helloAttempt || this.isTerminal()) {
        return;
      }
      this.helloFailures = 0;
      if (isDeviceSelf(session?.device)) {
        this.applySelf(session.device);
      }
      if (this.isTerminal()) {
        return;
      }
      this.tally.set(parseTally(session?.tally) ?? OFF_TALLY);
      this.phase.set('online');
      this.everOnline = true;
      const media = this.media;
      if (media !== null && isTerminalState(media.session.state)) {
        media.session.restart();
      }
      this.refreshConnection();
      this.updateDerived();
      void this.sendReport();
      this.scheduleFirstTechCheck();
    } catch (error) {
      if (attempt !== this.helloAttempt || this.isTerminal()) {
        return;
      }
      if (isBlockedHubError(error)) {
        this.enterBlocked();
        return;
      }
      if (hub.state !== 'connected') {
        return;
      }
      this.helloFailures++;
      this.helloTimer = setTimeout(
        () => void this.sayHello(),
        Math.max(500, backoffDelay(this.helloFailures)),
      );
    }
  }

  private onTally(value: unknown): void {
    const tally = parseTally(value);
    if (tally !== null) {
      this.tally.set(tally);
      this.updateDerived();
    }
  }

  private onSelf(value: unknown): void {
    if (isDeviceSelf(value)) {
      this.applySelf(value);
    }
  }

  private onCommand(value: unknown): void {
    const command = parseCommand(value);
    if (command === null || this.isTerminal()) {
      return;
    }
    switch (command.kind) {
      case 'message':
        this.showMessage(command);
        break;
      case 'reshare':
        this.requestReshare(command.slot);
        break;
      case 'switchCamera':
        this.toggleFacing();
        break;
    }
  }

  private showMessage(command: DeviceCommandDto): void {
    const text = command.text?.trim() ?? '';
    if (text === '') {
      return;
    }
    const at = new Date(command.at);
    const message: RegieMessage = {
      id: command.id,
      text,
      at: Number.isNaN(at.getTime()) ? new Date() : at,
    };
    this.message.set(message);
    if (this.kind() === 'phone' || this.env.isPhone()) {
      this.env.vibrate([200, 100, 200]);
    }
    this.clearTimer('messageTimer');
    this.messageTimer = setTimeout(() => {
      if (this.message()?.id === message.id) {
        this.message.set(null);
      }
    }, MESSAGE_DISMISS_MS);
  }

  private requestReshare(slot: string | null): void {
    if (slot === null || slotKind(slot) !== 'screen') {
      return;
    }
    const target = this.slots().find((entry) => entry.slot === slot);
    if (target === undefined || target.state === 'live' || target.state === 'starting') {
      return;
    }
    this.setReshare(slot, true);
  }

  private applySelf(self: DeviceSelfDto): void {
    const previous = this.self();
    this.self.set(self);
    if (previous !== null) {
      for (const slot of previous.slots) {
        if (
          !self.slots.some((entry) => entry.slot === slot.slot) &&
          !this.pendingScreens().has(slot.slot)
        ) {
          void this.media?.publisher.unpublish(slot.slot);
          this.setSynthetic(slot.slot, null);
          this.setReshare(slot.slot, false);
          this.forgetSharedScreen(slot.slot);
        }
      }
    }
    if (self.state === 'blocked') {
      this.enterBlocked();
      return;
    }
    this.maybeAutoStartCamera();
  }

  // ---- Media --------------------------------------------------------------------------------------------------

  private onMediaState(state: MediaSessionState): void {
    this.mediaState.set(state);
    if (!this.isTerminal()) {
      if (state === 'replaced') {
        this.enterReplaced();
      } else if (state === 'unauthorized' || state === 'removed') {
        void this.verifyAccess();
      }
    }
    this.refreshConnection();
  }

  private onSlotState(slot: string, state: LocalSlotState, message?: string): void {
    this.slotStates.update((states) => ({
      ...states,
      [slot]: { state, message: message ?? null },
    }));
    this.previewRevision.update((revision) => revision + 1);
    if (state === 'starting' || state === 'live') {
      this.setSynthetic(slot, null);
      this.setReshare(slot, false);
    }
    if (slotKind(slot) === 'screen') {
      if (state === 'live') {
        this.freshScreens.delete(slot);
        this.rememberSharedScreen(slot);
      } else if (state === 'idle' && message === CANCELLED_MESSAGE && this.freshScreens.has(slot)) {
        this.releaseCancelledScreen(slot);
      }
    }
    if (slot === 'camera' && this.firstCheckPending && (state === 'live' || state === 'failed')) {
      void this.runTechCheck();
    }
    this.updateDerived();
  }

  private async allocateScreen(predicted: string): Promise<void> {
    try {
      const allocated = await this.api.allocateSlot('screen');
      this.addSlotToSelf(allocated);
      this.pendingScreens.update(
        (pending) => new Set([...pending].filter((slot) => slot !== predicted)),
      );
      if (allocated.slot !== predicted) {
        // Another tab added a screen meanwhile: the share runs into a slot the server did not give us.
        this.freshScreens.delete(predicted);
        void this.media?.publisher.unpublish(predicted);
        this.actionError.set(
          `Bitte bei «Bildschirm ${slotNumber(allocated.slot)}» noch einmal auf «Bildschirm teilen» klicken.`,
        );
        return;
      }
      if (this.cancelledScreens.delete(predicted)) {
        void this.releaseQuietly(predicted);
      }
    } catch (error) {
      this.pendingScreens.update(
        (pending) => new Set([...pending].filter((slot) => slot !== predicted)),
      );
      this.freshScreens.delete(predicted);
      this.cancelledScreens.delete(predicted);
      void this.media?.publisher.unpublish(predicted);
      this.actionError.set(this.actionMessage(error));
    }
  }

  /** The picker of a freshly added screen was cancelled: the extra slot is not wanted. */
  private releaseCancelledScreen(slot: string): void {
    this.freshScreens.delete(slot);
    if (this.pendingScreens().has(slot)) {
      this.cancelledScreens.add(slot);
      return;
    }
    void this.releaseQuietly(slot);
  }

  private async releaseQuietly(slot: string): Promise<void> {
    try {
      await this.api.releaseSlot(slot);
      this.removeSlotFromSelf(slot);
    } catch {
      // The slot stays; the user can remove it with «Entfernen».
    }
  }

  // ---- Access: blocked, replaced, removed ---------------------------------------------------------------------

  /** Hub or media refused the credentials: `GET /me` tells whether the device is blocked, removed or fine. */
  private async verifyAccess(): Promise<void> {
    if (this.verifying || this.isTerminal()) {
      return;
    }
    this.verifying = true;
    try {
      const { self, rttMs } = await this.api.getSelfTimed();
      this.rttMs.set(rttMs);
      this.applySelf(self);
      if (!this.isTerminal()) {
        // Access is fine: the refusal was a race (e.g. right after an unblock). Connect again after a pause.
        this.scheduleAccess(ACCESS_RETRY_MS, () => this.resumeConnections());
      }
    } catch (error) {
      this.handleAccessError(toApiError(error), () =>
        this.scheduleAccess(ACCESS_RETRY_MS, () => void this.verifyAccess()),
      );
    } finally {
      this.verifying = false;
    }
  }

  private resumeConnections(): void {
    if (this.isTerminal()) {
      return;
    }
    const hub = this.hub;
    if (hub !== null && (hub.state === 'unauthorized' || hub.state === 'stopped')) {
      hub.restart();
    }
    const media = this.media;
    if (media !== null && isTerminalState(media.session.state)) {
      media.session.restart();
    }
  }

  private handleAccessError(error: ApiError, otherwise: () => void): void {
    if (error.isUnauthorized) {
      this.enterRemoved();
    } else if (error.status === 403) {
      this.enterBlocked();
    } else {
      if (error.isNetwork) {
        this.serverUnreachable.set(true);
      }
      otherwise();
    }
  }

  private enterBlocked(): void {
    if (this.phase() === 'blocked' || this.phase() === 'removed' || this.phase() === 'stopped') {
      return;
    }
    this.phase.set('blocked');
    this.clearTimer('accessTimer');
    this.clearTimer('helloTimer');
    this.hub?.markTerminal('unauthorized');
    this.media?.session.stop();
    this.reshareRequests.set(new Set());
    this.scheduleAccess(BLOCKED_RETRY_MS, () => void this.checkUnblocked());
    this.refreshConnection();
    this.updateDerived();
  }

  /** Every 15 s while blocked: continue as soon as the Regie unblocks the device. */
  private async checkUnblocked(): Promise<void> {
    if (this.phase() !== 'blocked') {
      return;
    }
    try {
      const { self, rttMs } = await this.api.getSelfTimed();
      if (this.phase() !== 'blocked') {
        return;
      }
      this.rttMs.set(rttMs);
      this.self.set(self);
      if (self.state === 'blocked') {
        this.scheduleAccess(BLOCKED_RETRY_MS, () => void this.checkUnblocked());
        return;
      }
      this.phase.set('connecting');
      this.hub?.restart();
      this.media?.session.restart();
      this.refreshConnection();
      this.updateDerived();
    } catch (error) {
      if (this.phase() !== 'blocked') {
        return;
      }
      const apiError = toApiError(error);
      if (apiError.isUnauthorized) {
        this.enterRemoved();
        return;
      }
      this.scheduleAccess(BLOCKED_RETRY_MS, () => void this.checkUnblocked());
    }
  }

  private enterReplaced(): void {
    if (this.isTerminal()) {
      return;
    }
    this.phase.set('replaced');
    this.clearTimer('helloTimer');
    this.clearTimer('accessTimer');
    this.hub?.markTerminal('stopped');
    this.media?.session.stop();
    this.refreshConnection();
    this.updateDerived();
  }

  private enterRemoved(): void {
    if (this.phase() === 'removed' || this.phase() === 'stopped') {
      return;
    }
    this.phase.set('removed');
    this.clearAllTimers();
    void this.hub?.stop();
    this.media?.session.stop();
    void this.media?.publisher.stopAll();
    this.credentials.clear();
    this.settingsService.update({ sharedScreens: [], techCheck: null });
    this.notices.pairingNotice.set(
      'Die Regie hat dieses Gerät entfernt. Du kannst es hier neu koppeln.',
    );
    this.refreshConnection();
    this.updateDerived();
  }

  // ---- Periodic work ------------------------------------------------------------------------------------------

  private async sendReport(): Promise<void> {
    const hub = this.hub;
    const media = this.media;
    if (
      hub === null ||
      media === null ||
      this.phase() !== 'online' ||
      hub.state !== 'connected' ||
      this.reporting
    ) {
      return;
    }
    this.reporting = true;
    try {
      const [telemetry, battery] = await Promise.all([
        media.publisher.getSlotTelemetry().catch(() => []),
        this.env.battery().catch(() => null),
      ]);
      const report = buildDeviceReport({
        mediaState: media.session.state,
        telemetry,
        deviceSlots: this.self()?.slots.map((slot) => slot.slot) ?? null,
        synthetic: this.synthetic(),
        battery,
        network: this.env.networkType(),
        rttMs: this.rttMs(),
        techCheck: this.techCheck(),
      });
      if (this.phase() !== 'online' || hub.state !== 'connected') {
        return;
      }
      this.lastReportSent = report;
      await hub.send(HUB.report, report);
    } catch {
      // The next report follows in 2 s.
    } finally {
      this.reporting = false;
    }
  }

  /** RTT probe and self refresh; also notices a removed or blocked device while the hub is down. */
  private async probeSelf(): Promise<void> {
    if (this.probing || this.isTerminal() || this.phase() === 'idle') {
      return;
    }
    this.probing = true;
    try {
      const { self, rttMs } = await this.api.getSelfTimed();
      if (this.isTerminal()) {
        return;
      }
      this.rttMs.set(rttMs);
      this.serverUnreachable.set(false);
      this.applySelf(self);
    } catch (error) {
      if (!this.isTerminal()) {
        this.handleAccessError(toApiError(error), () => undefined);
      }
    } finally {
      this.probing = false;
    }
  }

  private onWake(): void {
    this.now.set(Date.now());
    void this.probeSelf();
    void this.sendReport();
  }

  private scheduleFirstTechCheck(): void {
    if (this.firstCheckPending || this.techCheck() !== null || this.techCheckRunning()) {
      return;
    }
    this.firstCheckPending = true;
    const cameraState = this.camera()?.state ?? 'idle';
    const waitForCamera = this.camera() !== null && this.settingsService.settings().cameraOn;
    if (cameraState === 'live' || cameraState === 'failed') {
      void this.runTechCheck();
      return;
    }
    this.techCheckTimer = setTimeout(
      () => {
        if (this.firstCheckPending) {
          void this.runTechCheck();
        }
      },
      waitForCamera ? TECH_CHECK_CAMERA_WAIT_MS : 1500,
    );
  }

  // ---- Helpers ------------------------------------------------------------------------------------------------

  private maybeAutoStartCamera(): void {
    if (
      this.autoStartDone ||
      this.media === null ||
      this.isTerminal() ||
      !this.settingsService.settings().cameraOn ||
      !this.self()?.slots.some((slot) => slot.slot === 'camera')
    ) {
      return;
    }
    if (this.media.publisher.slotState('camera') !== 'idle') {
      this.autoStartDone = true;
      return;
    }
    this.startCamera();
  }

  private restoreSettings(): void {
    const deviceId = this.credentials.credentials()?.deviceId;
    if (deviceId !== undefined) {
      this.techCheck.set(this.settingsService.techCheckFor(deviceId));
    }
    const shared = this.settingsService.settings().sharedScreens;
    if (shared.length > 0) {
      this.synthetic.update((map) => {
        const next = new Map(map);
        for (const slot of shared) {
          next.set(slot, 'ended');
        }
        return next;
      });
    }
  }

  private setSynthetic(slot: string, state: SyntheticSlotState | null): void {
    const current = this.synthetic().get(slot) ?? null;
    if (current === state) {
      return;
    }
    this.synthetic.update((map) => {
      const next = new Map(map);
      if (state === null) {
        next.delete(slot);
      } else {
        next.set(slot, state);
      }
      return next;
    });
  }

  private setReshare(slot: string, requested: boolean): void {
    if (this.reshareRequests().has(slot) === requested) {
      return;
    }
    this.reshareRequests.update((set) => {
      const next = new Set(set);
      if (requested) {
        next.add(slot);
      } else {
        next.delete(slot);
      }
      return next;
    });
  }

  private rememberSharedScreen(slot: string): void {
    const shared = this.settingsService.settings().sharedScreens;
    if (!shared.includes(slot)) {
      this.settingsService.update({ sharedScreens: [...shared, slot] });
    }
  }

  private forgetSharedScreen(slot: string): void {
    const shared = this.settingsService.settings().sharedScreens;
    if (shared.includes(slot)) {
      this.settingsService.update({ sharedScreens: shared.filter((entry) => entry !== slot) });
    }
  }

  private addSlotToSelf(slot: DeviceSlotDto): void {
    const self = this.self();
    if (self === null || self.slots.some((entry) => entry.slot === slot.slot)) {
      return;
    }
    this.self.set({ ...self, slots: [...self.slots, slot] });
  }

  private removeSlotFromSelf(slot: string): void {
    const self = this.self();
    if (self !== null) {
      this.self.set({ ...self, slots: self.slots.filter((entry) => entry.slot !== slot) });
    }
  }

  private actionMessage(error: unknown): string {
    return toApiError(error).message;
  }

  private updateDerived(): void {
    const slots = this.slots();
    const terminal = this.phase() === 'removed' || this.phase() === 'stopped';
    const phoneWaiting =
      this.kind() === 'phone' && this.settingsService.settings().cameraOn && !terminal;
    if (!terminal && (this.sending() || phoneWaiting)) {
      void this.wakeLock?.enable();
    } else {
      void this.wakeLock?.disable();
    }
    this.liveState.onAir.set(this.phase() === 'online' && this.tally().overall !== 'off');
    this.liveState.sharingScreen.set(
      slots.some((slot) => slot.kind === 'screen' && SENDING.has(slot.state)),
    );
  }

  private refreshConnection(): void {
    const view = this.computeConnection();
    this.connection.set(view);
    if (view === 'reconnecting' || view === 'offline') {
      if (this.degradedSince() === null) {
        this.degradedSince.set(Date.now());
        this.now.set(Date.now());
      }
    } else {
      this.degradedSince.set(null);
    }
  }

  private computeConnection(): ConnectionView {
    switch (this.phase()) {
      case 'blocked':
        return 'blocked';
      case 'replaced':
        return 'replaced';
      case 'removed':
      case 'stopped':
        return 'removed';
      default:
        break;
    }
    if (!this.network.online()) {
      return 'offline';
    }
    if (
      this.phase() === 'online' &&
      this.hubState() === 'connected' &&
      this.mediaState() === 'connected'
    ) {
      return 'connected';
    }
    return this.everOnline ? 'reconnecting' : 'connecting';
  }

  private isTerminal(): boolean {
    return TERMINAL_PHASES.has(this.phase());
  }

  private scheduleAccess(delayMs: number, action: () => void): void {
    this.clearTimer('accessTimer');
    this.accessTimer = setTimeout(() => {
      this.accessTimer = null;
      action();
    }, delayMs);
  }

  private clearTimer(name: 'accessTimer' | 'helloTimer' | 'messageTimer' | 'techCheckTimer'): void {
    const timer = this[name];
    if (timer !== null) {
      clearTimeout(timer);
      this[name] = null;
    }
  }

  private clearAllTimers(): void {
    this.clearTimer('accessTimer');
    this.clearTimer('helloTimer');
    this.clearTimer('messageTimer');
    this.clearTimer('techCheckTimer');
    for (const interval of this.intervals.splice(0)) {
      clearInterval(interval);
    }
  }

  private installTestHook(): void {
    const view = this.document.defaultView as (Window & { __fsSender?: unknown }) | null;
    if (view === null) {
      return;
    }
    const hook = Object.freeze({
      slots: (): Record<string, string> =>
        Object.fromEntries(this.slots().map((slot) => [slot.slot, slot.state])),
      rtc: (): string => toRtcState(this.mediaState()),
      sessionId: this.sessionId,
    });
    Object.defineProperty(view, '__fsSender', { value: hook, configurable: true });
  }

  private shutdown(): void {
    if (this.phase() !== 'removed') {
      this.phase.set('stopped');
    }
    this.clearAllTimers();
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    void this.hub?.stop();
    this.media?.session.stop();
    this.media?.publisher.dispose();
    this.wakeLock?.dispose();
    this.liveState.reset();
    const view = this.document.defaultView as (Window & { __fsSender?: unknown }) | null;
    if (view !== null && '__fsSender' in view) {
      delete view.__fsSender;
    }
  }
}
