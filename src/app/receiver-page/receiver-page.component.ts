import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, OnInit, signal } from '@angular/core';
import { MediaFile } from '../../api/video-v1/model/mediaFile';
import { Subtitles } from '../../api/video-v1/model/subtitles';
import { TimeCodes } from '../../api/video-v1/model/timeCodes';
import { CastSessionUpdateMessage, CastSkipTimeCodeMessage, CastTimeCodeAvailabilityMessage } from '../../sdk';

declare global {
  interface Window {
    cast?: any;
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
  }
}

const CAST_RECEIVER_SCRIPT_URL = 'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js';
const NEXT_UP_PREVIEW_SECONDS = 30;
const CONTROLS_HIDE_DELAY_MS = 5000;
const DEBUG_EVENT_THROTTLE_MS = 500;
const SHOW_DEBUG_OVERLAY = false;
const CONFIG_ENDPOINT_URL = 'https://prod95-cdn.dr-massive.com/api/config?device=chromecast&ff=idp%2Cldp%2Crpt&include=classification%2Csubscription%2Csitemap%2Cnavigation%2Cgeneral%2Ci18n%2Cplayback%2Clinear%2CfeatureFlags&lang=da&segments=drtv&sub=Registered';
const PAGE_ENDPOINT_BASE_URL = 'https://prod95-cdn.dr-massive.com/api/page';
const VIDEO_ENDPOINT_BASE_URL = 'https://prod95.dr-massive.com/api/account/items';
const VIDEO_ENDPOINT_DEVICE = 'chromecast';
const DR_TV_CUSTOM_NAMESPACE = 'urn:x-cast:dk.dr.tv.chromecast';
const SKIP_TIME_CODE_TYPE = 'Intro';

type ReceiverUiState = 'awaiting-cast' | 'connected-idle' | 'playing';

interface ResolvedPlayback {
  streamUrl: string;
  mimeType: string;
  title?: string;
  subtitle?: string;
  posterUrl?: string;
  accessService?: string | null;
  subtitlesEnabled?: boolean;
  textTracks?: any[];
  skipTimeCode?: NormalizedTimeCode | null;
}

interface QueueItemRuntimeData {
  path: string | null;
  accessToken: string | null;
  preferredAccessService: string | null;
}

interface QueueItemPreview {
  title: string | null;
  thumbnail: string | null;
}

interface NormalizedTimeCode {
  startTime: number;
  endTime: number;
  duration: number;
  timeCodeType: string;
}

interface ReceiverSessionContext {
  accessToken: string | null;
  idToken: string | null;
  segments: string[];
  anonymousId: string | null;
}

interface ReceiverDebugState {
  path: string | null;
  pageUrl: string | null;
  pageStatus: number | null;
  itemId: string | null;
  videoUrl: string | null;
  videoStatus: number | null;
  streamUrl: string | null;
  contentType: string | null;
  sessionAccessToken: string | null;
  sessionIdToken: string | null;
  sessionSegments: string[];
  sessionAnonymousId: string | null;
  sessionUpdatedAt: string | null;
  playerState: string | null;
  lastEvent: string | null;
  lastError: string | null;
}

function loadReceiverFramework(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Cast receiver framework requires a browser environment.'));
  }

  if (window.cast?.framework?.CastReceiverContext) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const previousCallback = window.__onGCastApiAvailable;
    const completeResolve = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      window.__onGCastApiAvailable = previousCallback;
      resolve();
    };

    const completeReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      window.__onGCastApiAvailable = previousCallback;
      reject(error);
    };

    const isFrameworkReady = (): boolean => Boolean(window.cast?.framework?.CastReceiverContext);

    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      previousCallback?.(isAvailable);
      if (isAvailable && isFrameworkReady()) {
        completeResolve();
      } else if (!isAvailable) {
        completeReject(new Error('Cast receiver framework is unavailable.'));
      }
    };

    const timeoutId = setTimeout(() => {
      if (isFrameworkReady()) {
        completeResolve();
        return;
      }

      completeReject(new Error('Timed out while waiting for Cast receiver framework to initialize.'));
    }, 8000);

    const existing = document.querySelector<HTMLScriptElement>('script[src*="cast_receiver_framework.js"]');
    if (existing) {
      if (isFrameworkReady()) {
        completeResolve();
        return;
      }

      existing.addEventListener(
        'load',
        () => {
          if (isFrameworkReady()) {
            completeResolve();
            return;
          }

          completeReject(new Error('Cast receiver framework script loaded but CAF is unavailable.'));
        },
        { once: true }
      );
      existing.addEventListener('error', () => completeReject(new Error('Failed to load Cast receiver framework')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = CAST_RECEIVER_SCRIPT_URL;
    script.addEventListener(
      'load',
      () => {
        if (isFrameworkReady()) {
          completeResolve();
          return;
        }

        completeReject(new Error('Cast receiver framework script loaded but CAF is unavailable.'));
      },
      { once: true }
    );
    script.addEventListener('error', () => completeReject(new Error('Failed to load Cast receiver framework')), { once: true });
    document.head.appendChild(script);
  });
}

@Component({
  selector: 'app-receiver-page',
  imports: [CommonModule],
  templateUrl: './receiver-page.component.html',
  styleUrl: './receiver-page.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ReceiverPageComponent implements OnInit, OnDestroy {
  protected readonly appVersion = signal('0.0.1');
  protected readonly showDebugOverlay = SHOW_DEBUG_OVERLAY;
  protected readonly title = signal('Waiting for content');
  protected readonly subtitle = signal('Idle');
  protected readonly receiverError = signal<string | null>(null);
  protected readonly uiState = signal<ReceiverUiState>('awaiting-cast');
  protected readonly hasSenderConnected = signal(false);
  protected readonly queueStatus = signal<string>('idle');
  protected readonly isPlaying = signal(false);
  protected readonly showProgressBarLogo = signal(false);
  protected readonly currentTimeSec = signal(0);
  protected readonly durationSec = signal(0);
  private controlsHideTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly nextItemTitle = signal<string | null>(null);
  protected readonly nextItemThumbnail = signal<string | null>(null);
  protected readonly showNextUp = signal(false);
  protected readonly configResponse = signal<unknown | null>(null);
  protected readonly logs = signal<string[]>([]);
  protected readonly debugState = signal<ReceiverDebugState>({
    path: null,
    pageUrl: null,
    pageStatus: null,
    itemId: null,
    videoUrl: null,
    videoStatus: null,
    streamUrl: null,
    contentType: null,
    sessionAccessToken: null,
    sessionIdToken: null,
    sessionSegments: [],
    sessionAnonymousId: null,
    sessionUpdatedAt: null,
    playerState: null,
    lastEvent: null,
    lastError: null,
  });

  private storedQueueItems: any[] = [];
  private storedActiveItemId: string | null = null;
  private lastDebugOverlayEventAt = 0;
  private lastDebugOverlayEvent: string | null = null;
  private pendingSubtitleTrackIds: number[] = [];
  private pendingSubtitlesEnabled = false;
  private activeSkipTimeCode: NormalizedTimeCode | null = null;
  private lastSkipAvailabilityVisible: boolean | null = null;
  private readonly connectedSenderIds = new Set<string>();
  private sessionContext: ReceiverSessionContext = {
    accessToken: null,
    idToken: null,
    segments: [],
    anonymousId: null,
  };

  private parseSessionUpdateMessage(data: unknown): CastSessionUpdateMessage | null {
    let candidate = data;

    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        return null;
      }
    }

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const message = candidate as Partial<CastSessionUpdateMessage>;
    if (message.type !== 'sessionUpdate') {
      return null;
    }

    if (typeof message.auth?.accessToken !== 'string' || typeof message.auth?.idToken !== 'string') {
      return null;
    }

    if (!Array.isArray(message.segments) || !message.segments.every((segment) => typeof segment === 'string')) {
      return null;
    }

    if (typeof message.tracking?.anonymousId !== 'string') {
      return null;
    }

    return {
      type: 'sessionUpdate',
      auth: {
        accessToken: message.auth.accessToken,
        idToken: message.auth.idToken,
      },
      segments: [...message.segments],
      tracking: {
        anonymousId: message.tracking.anonymousId,
      },
    };
  }

  private parseSkipTimeCodeMessage(data: unknown): CastSkipTimeCodeMessage | null {
    let candidate = data;

    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        return null;
      }
    }

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const message = candidate as Partial<CastSkipTimeCodeMessage>;
    if (message.type !== 'skipTimeCode' || typeof message.timeCodeType !== 'string' || !message.timeCodeType.trim()) {
      return null;
    }

    return {
      type: 'skipTimeCode',
      timeCodeType: message.timeCodeType.trim(),
    };
  }

  private toNormalizedTimeCode(timeCode: TimeCodes): NormalizedTimeCode | null {
    if (!timeCode || typeof timeCode.timeCodeType !== 'string' || typeof timeCode.startTime !== 'number') {
      return null;
    }

    const rawStart = timeCode.startTime;
    const rawEnd = typeof timeCode.endTime === 'number' ? timeCode.endTime : rawStart;
    const rawDuration = typeof timeCode.duration === 'number' ? timeCode.duration : rawEnd - rawStart;
    const looksLikeMilliseconds = rawDuration > 1000 || rawEnd - rawStart > 1000;
    const unit = looksLikeMilliseconds ? 1000 : 1;

    const startTime = rawStart / unit;
    const duration = Math.max(0, rawDuration / unit);
    const endTime = rawEnd > rawStart ? rawEnd / unit : startTime + duration;

    if (!isFinite(startTime) || !isFinite(endTime) || endTime <= startTime) {
      return null;
    }

    return {
      startTime,
      endTime,
      duration: duration > 0 ? duration : endTime - startTime,
      timeCodeType: timeCode.timeCodeType,
    };
  }

  private buildSkipAvailabilityMessage(visible: boolean): CastTimeCodeAvailabilityMessage {
    const active = this.activeSkipTimeCode;
    return {
      type: 'timeCodeAvailability',
      visible,
      timeCodeType: active?.timeCodeType ?? SKIP_TIME_CODE_TYPE,
      startTime: active?.startTime ?? 0,
      endTime: active?.endTime ?? 0,
      duration: active?.duration ?? 0,
    };
  }

  private refreshConnectedSenderIds(context: any): void {
    const senders = context?.getSenders?.();
    if (!Array.isArray(senders)) {
      return;
    }

    for (const senderId of senders) {
      if (typeof senderId === 'string' && senderId.trim()) {
        this.connectedSenderIds.add(senderId);
      }
    }
  }

  private broadcastCustomMessageToSenders(payload: CastTimeCodeAvailabilityMessage): void {
    const context = window.cast?.framework?.CastReceiverContext?.getInstance?.();
    if (!context?.sendCustomMessage) {
      return;
    }

    this.refreshConnectedSenderIds(context);

    if (this.connectedSenderIds.size === 0) {
      try {
        // Fallback broadcast when sender IDs are not exposed by this runtime.
        context.sendCustomMessage(DR_TV_CUSTOM_NAMESPACE, undefined, payload);
      } catch {
        // Ignore sender-specific channel failures.
      }
      return;
    }

    for (const senderId of this.connectedSenderIds) {
      try {
        context.sendCustomMessage(DR_TV_CUSTOM_NAMESPACE, senderId, payload);
      } catch {
        // Ignore sender-specific channel failures and keep broadcasting to remaining senders.
      }
    }
  }

  private updateSkipAvailabilityForCurrentTime(currentTimeSec: number): void {
    const active = this.activeSkipTimeCode;
    if (!active) {
      if (this.lastSkipAvailabilityVisible === false) {
        return;
      }

      this.lastSkipAvailabilityVisible = false;
      this.broadcastCustomMessageToSenders(this.buildSkipAvailabilityMessage(false));
      this.recordReceiverEvent('timeCodeAvailability sent', `hidden (${SKIP_TIME_CODE_TYPE})`);
      return;
    }

    const endTime = active.endTime;
    const shouldShow = isFinite(currentTimeSec)
      && currentTimeSec >= active.startTime
      && currentTimeSec < endTime;

    if (this.lastSkipAvailabilityVisible === shouldShow) {
      return;
    }

    this.lastSkipAvailabilityVisible = shouldShow;
    this.broadcastCustomMessageToSenders(this.buildSkipAvailabilityMessage(shouldShow));
    this.recordReceiverEvent('timeCodeAvailability sent', `${shouldShow ? 'visible' : 'hidden'} (${active.timeCodeType})`);
  }

  private clearSkipTimeCodeState(): void {
    this.activeSkipTimeCode = null;
    this.lastSkipAvailabilityVisible = null;
    this.broadcastCustomMessageToSenders(this.buildSkipAvailabilityMessage(false));
  }

  private handleSkipTimeCodeRequest(message: CastSkipTimeCodeMessage, playerManager: any): void {
    const active = this.activeSkipTimeCode;
    if (!active || active.timeCodeType.toLowerCase() !== message.timeCodeType.toLowerCase()) {
      this.recordReceiverEvent('Skip ignored', `No active ${message.timeCodeType} timeCode`);
      return;
    }

    const targetTimeSec = active.endTime;
    if (!isFinite(targetTimeSec)) {
      this.recordReceiverEvent('Skip failed', 'Target time is invalid');
      return;
    }

    const clampedTargetSec = Math.max(0, targetTimeSec);
    let seekApplied = false;

    try {
      const SeekRequestDataCtor = window.cast?.framework?.messages?.SeekRequestData;
      const ResumeState = window.cast?.framework?.messages?.ResumeState;
      if (typeof playerManager?.seek === 'function' && typeof SeekRequestDataCtor === 'function') {
        const seekRequestData = new SeekRequestDataCtor();
        seekRequestData.currentTime = clampedTargetSec;
        if (ResumeState?.PLAYBACK_START) {
          seekRequestData.resumeState = ResumeState.PLAYBACK_START;
        }
        playerManager.seek(seekRequestData);
        seekApplied = true;
      }
    } catch {
      // Fall back to direct media-element seek below.
    }

    if (!seekApplied) {
      const mediaElement = playerManager?.getMediaElement?.() as HTMLMediaElement | null;
      if (mediaElement) {
        mediaElement.currentTime = clampedTargetSec;
        seekApplied = true;
      }
    }

    if (!seekApplied) {
      this.recordReceiverEvent('Skip failed', 'No supported seek API available');
      return;
    }

    this.currentTimeSec.set(clampedTargetSec);
    this.recordReceiverEvent('Skip applied', `${message.timeCodeType} -> ${targetTimeSec.toFixed(1)}s`);
    this.updateSkipAvailabilityForCurrentTime(clampedTargetSec);
  }

  private applySessionUpdate(message: CastSessionUpdateMessage): void {
    this.sessionContext = {
      accessToken: message.auth.accessToken,
      idToken: message.auth.idToken,
      segments: [...message.segments],
      anonymousId: message.tracking.anonymousId,
    };

    const maskToken = (token: string): string => {
      if (token.length <= 12) {
        return token;
      }

      return `${token.slice(0, 6)}...${token.slice(-4)}`;
    };

    this.updateDebugState({
      sessionAccessToken: maskToken(message.auth.accessToken),
      sessionIdToken: maskToken(message.auth.idToken),
      sessionSegments: [...message.segments],
      sessionAnonymousId: message.tracking.anonymousId,
      sessionUpdatedAt: new Date().toISOString(),
    });

    this.recordReceiverEvent(
      'Session updated',
      `segments=${message.segments.length} anonymousId=${message.tracking.anonymousId}`,
    );
  }

  async ngOnInit(): Promise<void> {
    this.pushLog('Receiver booting');
    this.receiverError.set(null);
    try {
      await this.loadConfigResponse();
      await loadReceiverFramework();
      this.pushLog('CAF framework loaded');
      this.initializeReceiver();
    } catch (err: any) {
      const message = err?.message ?? String(err);
      this.receiverError.set(message);
      this.updateDebugState({ lastError: message });
      this.pushLog('Receiver initialization failed: ' + message);
    }
  }

  ngOnDestroy(): void {
    if (this.controlsHideTimer !== null) {
      clearTimeout(this.controlsHideTimer);
    }
  }

  protected formatTime(secs: number): string {
    if (!isFinite(secs) || secs < 0) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  private setProgressBarLogoVisible(visible: boolean): void {
    if (this.controlsHideTimer !== null) {
      clearTimeout(this.controlsHideTimer);
      this.controlsHideTimer = null;
    }
    this.showProgressBarLogo.set(visible);
  }

  private updateUiState(): void {
    if (this.isPlaying()) {
      this.uiState.set('playing');
      return;
    }

    if (this.hasSenderConnected()) {
      this.uiState.set('connected-idle');
      return;
    }

    this.uiState.set('awaiting-cast');
  }

  private pushLog(message: string): void {
    const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
    this.logs.update((current) => [entry, ...current].slice(0, 200));
    console.log(message);
  }

  private updateDebugState(patch: Partial<ReceiverDebugState>): void {
    this.debugState.update((current) => ({
      ...current,
      ...patch,
    }));
  }

  private recordReceiverEvent(eventName: string, details?: string): void {
    const summary = details ? `${eventName}: ${details}` : eventName;
    this.pushLog(summary);

    if (!this.showDebugOverlay) {
      return;
    }

    const isNoisyEvent = summary.startsWith('CORE ') || summary.startsWith('DEBUG ');
    const now = Date.now();
    if (isNoisyEvent && now - this.lastDebugOverlayEventAt < DEBUG_EVENT_THROTTLE_MS) {
      return;
    }

    if (summary === this.lastDebugOverlayEvent) {
      return;
    }

    this.lastDebugOverlayEvent = summary;
    this.lastDebugOverlayEventAt = now;
    this.updateDebugState({ lastEvent: summary });
  }

  private updateNextUpVisibility(currentTimeSec: number = this.currentTimeSec(), durationSec: number = this.durationSec()): void {
    if (!this.nextItemTitle() || !this.nextItemThumbnail()) {
      this.showNextUp.set(false);
      return;
    }

    if (!isFinite(durationSec) || durationSec <= 0) {
      this.showNextUp.set(false);
      return;
    }

    const remainingSeconds = durationSec - currentTimeSec;
    this.showNextUp.set(remainingSeconds >= 0 && remainingSeconds <= NEXT_UP_PREVIEW_SECONDS);
  }

  private async loadConfigResponse(): Promise<void> {
    try {
      this.pushLog('Fetching receiver config');
      const response = await fetch(CONFIG_ENDPOINT_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Config request failed with ${response.status}`);
      }

      const configJson = await response.json();
      this.configResponse.set(configJson);
      this.receiverError.set(null);
      this.pushLog('Receiver config loaded');
    } catch (error: any) {
      this.configResponse.set(null);
      this.pushLog('Receiver config fetch failed: ' + (error?.message ?? String(error)));
    }
  }

  private buildPageUrl(path: string): string {
    const query = new URLSearchParams({
      device: 'chromecast',
      ff: 'idp,ldp,rpt',
      geoLocation: 'dk',
      isDeviceAbroad: 'false',
      item_detail_expand: 'all',
      lang: 'da',
      list_page_size: '24',
      max_list_prefetch: '3',
      path,
      segments: 'drtv,optedin',
      sub: 'Registered',
      text_entry_format: 'html',
    });

    return `${PAGE_ENDPOINT_BASE_URL}?${query.toString()}`;
  }

  private buildVideoUrl(itemId: string): string {
    const query = new URLSearchParams({
      delivery: 'stream',
      device: VIDEO_ENDPOINT_DEVICE,
      ff: 'idp,ldp,rpt',
      geoLocation: 'dk',
      lang: 'da',
      resolution: 'HD-1080',
      sub: 'Registered',
    });

    return `${VIDEO_ENDPOINT_BASE_URL}/${encodeURIComponent(itemId)}/videos?${query.toString()}`;
  }

  private extractItemId(path: string, item: any): string | null {
    const directId = item?.id;
    if (typeof directId === 'string' && directId.trim()) {
      return directId;
    }

    const scopes = item?.scopes;
    if (Array.isArray(scopes)) {
      const scopedId = scopes.find((scope: unknown) => typeof scope === 'string' && /^\d+$/.test(scope));
      if (typeof scopedId === 'string') {
        return scopedId;
      }
    }

    const pathMatch = path.match(/_(\d+)$/);
    return pathMatch?.[1] ?? null;
  }

  private resolveMimeType(_mediaFile: MediaFile): string {
    return 'application/x-mpegURL';
  }

  private getQueueItemRuntimeData(selectedItem: any, loadRequestData?: any): QueueItemRuntimeData {
    const queueCustomData = selectedItem?.customData ?? {};
    const mediaCustomData = loadRequestData?.media?.customData ?? {};

    const rawPath = queueCustomData.path ?? mediaCustomData.path ?? selectedItem?.url ?? null;
    const accessToken = queueCustomData.accessToken
      ?? mediaCustomData.accessToken
      ?? this.sessionContext.accessToken
      ?? null;
    const preferredAccessService = queueCustomData.preferredAccessService ?? mediaCustomData.preferredAccessService ?? null;

    return {
      path: typeof rawPath === 'string' ? rawPath : null,
      accessToken: typeof accessToken === 'string' ? accessToken : null,
      preferredAccessService: typeof preferredAccessService === 'string' ? preferredAccessService : null,
    };
  }

  private applyResolvedPlaybackToLoadRequest(loadRequestData: any, resolvedPlayback: ResolvedPlayback): void {
    if (!loadRequestData?.media) {
      return;
    }

    loadRequestData.autoplay = true;
    loadRequestData.media.contentId = resolvedPlayback.streamUrl;
    loadRequestData.media.contentUrl = resolvedPlayback.streamUrl;
    loadRequestData.media.contentType = resolvedPlayback.mimeType;
    loadRequestData.media.streamType = 'BUFFERED';
    this.updateDebugState({
      streamUrl: resolvedPlayback.streamUrl,
      contentType: resolvedPlayback.mimeType,
    });

    const metadata = loadRequestData.media.metadata ?? {};
    metadata.title = resolvedPlayback.title ?? metadata.title;
    metadata.subtitle = resolvedPlayback.subtitle ?? metadata.subtitle;

    if (resolvedPlayback.posterUrl) {
      metadata.images = [{ url: resolvedPlayback.posterUrl }];
    }

    loadRequestData.media.metadata = metadata;

    const textTracks = resolvedPlayback.textTracks ?? [];
    const subtitlesEnabled = resolvedPlayback.subtitlesEnabled === true;

    if (textTracks.length) {
      loadRequestData.media.tracks = textTracks;
      this.pendingSubtitleTrackIds = textTracks
        .map((track) => track?.trackId)
        .filter((trackId): trackId is number => typeof trackId === 'number');
      this.pendingSubtitlesEnabled = subtitlesEnabled;
      loadRequestData.activeTrackIds = subtitlesEnabled && this.pendingSubtitleTrackIds.length > 0
        ? [this.pendingSubtitleTrackIds[0]]
        : [];
    } else {
      loadRequestData.media.tracks = [];
      this.pendingSubtitleTrackIds = [];
      this.pendingSubtitlesEnabled = false;
      loadRequestData.activeTrackIds = [];
    }
  }

  private selectPlayableMediaFile(mediaFiles: MediaFile[], preferredAccessService: string | null = null): MediaFile | null {
    const playableFiles = mediaFiles.filter((file) => !!file.url);

    if (playableFiles.length === 0) {
      return null;
    }

    if (preferredAccessService) {
      const preferredCandidates = playableFiles.filter((file) => this.accessServiceMatches(file.accessService, preferredAccessService));
      if (preferredCandidates.length > 0) {
        return preferredCandidates.find((file) => file.format === 'video/hls') ?? preferredCandidates[0] ?? null;
      }
    }

    const hlsFiles = playableFiles.filter((file) => file.format === 'video/hls');
    const candidates = hlsFiles.length > 0 ? hlsFiles : playableFiles;

    return candidates.find((file) => this.isStandardAccessService(file.accessService))
      ?? candidates.find((file) => !this.isSpokenAccessService(file.accessService))
      ?? candidates[0]
      ?? null;
  }

  private normalizeAccessServiceName(accessService: string | null | undefined): string {
    if (typeof accessService !== 'string') {
      return '';
    }

    return accessService.trim().toLowerCase().replace(/[^a-z]/g, '');
  }

  private isSpokenAccessService(accessService: string | null | undefined): boolean {
    const normalized = this.normalizeAccessServiceName(accessService);
    return normalized.includes('spoken') && normalized.includes('subtitle');
  }

  private isStandardAccessService(accessService: string | null | undefined): boolean {
    const normalized = this.normalizeAccessServiceName(accessService);
    return normalized.includes('standard') && normalized.includes('video');
  }

  private accessServiceMatches(actual: string | null | undefined, preferred: string | null | undefined): boolean {
    const normalizedActual = this.normalizeAccessServiceName(actual);
    const normalizedPreferred = this.normalizeAccessServiceName(preferred);

    if (!normalizedActual || !normalizedPreferred) {
      return false;
    }

    if (this.isSpokenAccessService(normalizedPreferred)) {
      return this.isSpokenAccessService(normalizedActual);
    }

    if (this.isStandardAccessService(normalizedPreferred)) {
      return this.isStandardAccessService(normalizedActual);
    }

    return normalizedActual === normalizedPreferred;
  }

  private resolveSubtitleTrackSource(
    mediaFiles: MediaFile[],
    selectedFile: MediaFile,
    preferredAccessService: string | null,
  ): Array<Subtitles> | null | undefined {
    if (Array.isArray(selectedFile.subtitles) && selectedFile.subtitles.length > 0) {
      return selectedFile.subtitles;
    }

    const spokenCandidate = mediaFiles.find(
      (file) => this.isSpokenAccessService(file.accessService) && Array.isArray(file.subtitles) && file.subtitles.length > 0,
    );
    if (spokenCandidate) {
      return spokenCandidate.subtitles;
    }

    if (preferredAccessService && this.isStandardAccessService(preferredAccessService)) {
      return null;
    }

    const fallbackCandidate = mediaFiles.find((file) => Array.isArray(file.subtitles) && file.subtitles.length > 0);
    return fallbackCandidate?.subtitles;
  }

  private normalizeSubtitleMimeType(format: string | null | undefined): string {
    if (typeof format !== 'string' || !format.trim()) {
      return 'text/vtt';
    }

    return format.split(';')[0]?.trim() || 'text/vtt';
  }

  private normalizeSubtitleLanguage(language: string | null | undefined): string {
    if (typeof language !== 'string' || !language.trim()) {
      return 'da';
    }

    const normalized = language.trim();
    if (/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/i.test(normalized)) {
      return normalized.toLowerCase();
    }

    if (/combined|hearing|caption/i.test(normalized)) {
      return 'da';
    }

    return 'und';
  }

  private mapSubtitleSubtype(language: string | null | undefined): string {
    return /combined|hearing|caption/i.test(language ?? '') ? 'CAPTIONS' : 'SUBTITLES';
  }

  private buildTextTracks(subtitles: Array<Subtitles> | null | undefined): any[] {
    if (!Array.isArray(subtitles) || subtitles.length === 0) {
      return [];
    }

    const messages = window.cast?.framework?.messages;
    const TrackCtor = messages?.Track;
    const TrackType = messages?.TrackType;

    return subtitles
      .filter((subtitle) => typeof subtitle?.link === 'string' && !!subtitle.link)
      .map((subtitle, index) => {
        const track = typeof TrackCtor === 'function'
          ? new TrackCtor(index + 1, TrackType?.TEXT ?? 'TEXT')
          : {
              trackId: index + 1,
              type: TrackType?.TEXT ?? 'TEXT',
            };

        track.trackId = track.trackId ?? index + 1;
        track.trackContentId = subtitle.link;
        track.trackContentType = this.normalizeSubtitleMimeType(subtitle.format);
        track.language = this.normalizeSubtitleLanguage(subtitle.language);
        track.name = subtitle.language || `Subtitle ${index + 1}`;
        track.subtype = this.mapSubtitleSubtype(subtitle.language);
        track.isInband = false;

        return track;
      });
  }

  private async resolvePlaybackFromQueueItem(item: any, loadRequestData?: any): Promise<ResolvedPlayback> {
    const runtimeData = this.getQueueItemRuntimeData(item, loadRequestData);
    const rawPath = runtimeData.path;
    const accessToken = runtimeData.accessToken;
    const preferredAccessService = runtimeData.preferredAccessService;
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      throw new Error('Queue item path is missing.');
    }

    const normalizedPath = rawPath.trim().startsWith('/') ? rawPath.trim() : `/${rawPath.trim()}`;
    const pageUrl = this.buildPageUrl(normalizedPath);
    this.updateDebugState({
      path: normalizedPath,
      pageUrl,
      pageStatus: null,
      itemId: null,
      videoUrl: null,
      videoStatus: null,
      streamUrl: null,
      contentType: null,
      lastEvent: 'Resolving playback from queue item',
      lastError: null,
    });
    this.pushLog(`Resolving page for path ${normalizedPath}`);
    this.pushLog(`Page URL: ${pageUrl}`);

    const pageResponse = await fetch(pageUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    this.pushLog(`Page response status: ${pageResponse.status}`);
  this.updateDebugState({ pageStatus: pageResponse.status });

    if (!pageResponse.ok) {
      throw new Error(`Page request failed with ${pageResponse.status}`);
    }

    const pageJson = await pageResponse.json();
    const firstEntry = Array.isArray(pageJson?.entries) ? pageJson.entries[0] : null;
    const pageItem = firstEntry?.item;
    const itemId = this.extractItemId(normalizedPath, pageItem);
    if (!itemId) {
      throw new Error('Unable to resolve item id from page response.');
    }

    this.pushLog(`Resolved item id from page response: ${itemId}`);
    this.updateDebugState({ itemId });

    if (typeof accessToken !== 'string' || !accessToken.trim()) {
      throw new Error('Missing accessToken for protected video endpoint.');
    }

    const videoUrl = this.buildVideoUrl(itemId);
  this.updateDebugState({ videoUrl, videoStatus: null });
    this.pushLog(`Fetching media stream for item ${itemId}`);
    this.pushLog(`Video URL: ${videoUrl}`);
    const videoResponse = await fetch(videoUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken.trim()}`,
      },
    });

    this.pushLog(`Video response status: ${videoResponse.status}`);
  this.updateDebugState({ videoStatus: videoResponse.status });

    if (!videoResponse.ok) {
      throw new Error(`Video request failed with ${videoResponse.status}`);
    }

    const mediaFiles = await videoResponse.json() as MediaFile[];
    const primary = Array.isArray(mediaFiles) ? this.selectPlayableMediaFile(mediaFiles, preferredAccessService) : null;
    const streamUrl = primary?.url;
    if (typeof streamUrl !== 'string' || !streamUrl) {
      throw new Error('No playable stream URL found in video response.');
    }

    const selectedAccessService = typeof primary?.accessService === 'string' ? primary.accessService : null;
    const allTimeCodes = Array.isArray(mediaFiles)
      ? mediaFiles.flatMap((file) => (Array.isArray(file?.timeCodes) ? file.timeCodes : []))
      : [];
    const skipTimeCode = allTimeCodes
      .map((timeCode) => this.toNormalizedTimeCode(timeCode))
      .find((timeCode) => timeCode?.timeCodeType.toLowerCase() === SKIP_TIME_CODE_TYPE.toLowerCase())
      ?? null;
    const subtitlesEnabled = this.isSpokenAccessService(preferredAccessService);
    const subtitleSource = subtitlesEnabled
      ? this.resolveSubtitleTrackSource(Array.isArray(mediaFiles) ? mediaFiles : [], primary, preferredAccessService)
      : null;
    const textTracks = subtitlesEnabled ? this.buildTextTracks(subtitleSource) : [];

    this.pushLog(`Selected video URL from media file response: ${streamUrl}`);
    this.pushLog(
      `Selected accessService=${selectedAccessService ?? 'unknown'} preferred=${preferredAccessService ?? 'none'} subtitles=${subtitlesEnabled ? 'on' : 'off'} tracks=${textTracks.length}`
    );
    if (preferredAccessService && !this.accessServiceMatches(selectedAccessService, preferredAccessService)) {
      this.pushLog(`Preferred accessService ${preferredAccessService} not found for item ${itemId}; fell back to ${selectedAccessService ?? 'unknown'}`);
    }
    this.updateDebugState({
      streamUrl,
      contentType: this.resolveMimeType(primary),
    });

    return {
      streamUrl,
      mimeType: this.resolveMimeType(primary),
      title: firstEntry?.title ?? pageJson?.title ?? item?.title,
      subtitle: pageItem?.episodeName ?? pageItem?.showName ?? item?.subtitle,
      posterUrl: pageItem?.images?.tile ?? pageItem?.images?.wallpaper ?? pageItem?.images?.poster ?? item?.posterUrl,
      accessService: selectedAccessService,
      subtitlesEnabled,
      textTracks,
      skipTimeCode,
    };
  }

  private async resolveQueueItemPreview(item: any, loadRequestData?: any): Promise<QueueItemPreview> {
    const runtimeData = this.getQueueItemRuntimeData(item, loadRequestData);
    const rawPath = runtimeData.path;
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return {
        title: item?.title ?? null,
        thumbnail: item?.posterUrl ?? null,
      };
    }

    try {
      const normalizedPath = rawPath.trim().startsWith('/') ? rawPath.trim() : `/${rawPath.trim()}`;
      const pageUrl = this.buildPageUrl(normalizedPath);
      const response = await fetch(pageUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return {
          title: item?.title ?? null,
          thumbnail: item?.posterUrl ?? null,
        };
      }

      const pageJson = await response.json();
      const firstEntry = Array.isArray(pageJson?.entries) ? pageJson.entries[0] : null;
      const pageItem = firstEntry?.item;

      return {
        title: pageJson?.title ?? firstEntry?.title ?? null,
        thumbnail: pageItem?.images?.tile ?? pageItem?.images?.wallpaper ?? pageItem?.images?.poster ?? item?.posterUrl ?? null,
      };
    } catch {
      return {
        title: item?.title ?? null,
        thumbnail: item?.posterUrl ?? null,
      };
    }
  }

  private initializeReceiver(): void {
    try {
      const context = window.cast.framework.CastReceiverContext.getInstance();
      const playerManager = context.getPlayerManager();
      const MessageType = window.cast.framework.messages.MessageType;
      const eventCategory = window.cast?.framework?.events?.category;

      const systemEventType = window.cast?.framework?.system?.EventType;
      if (systemEventType?.SENDER_CONNECTED) {
        context.addEventListener(systemEventType.SENDER_CONNECTED, (event: any) => {
          const senderId = event?.senderId;
          if (typeof senderId === 'string' && senderId.trim()) {
            this.connectedSenderIds.add(senderId);
          }
          this.refreshConnectedSenderIds(context);

          this.hasSenderConnected.set(true);
          this.updateUiState();
          this.recordReceiverEvent('Sender connected');
          this.updateSkipAvailabilityForCurrentTime(this.currentTimeSec());
        });
      }
      if (systemEventType?.SENDER_DISCONNECTED) {
        context.addEventListener(systemEventType.SENDER_DISCONNECTED, (event: any) => {
          const senderId = event?.senderId;
          if (typeof senderId === 'string' && senderId.trim()) {
            this.connectedSenderIds.delete(senderId);
          }

          this.hasSenderConnected.set(false);
          this.updateUiState();
          this.recordReceiverEvent('Sender disconnected');
        });
      }

      if (eventCategory?.CORE) {
        playerManager.addEventListener(eventCategory.CORE, (event: any) => {
          const eventType = event?.type ?? 'unknown-core-event';
          this.recordReceiverEvent(`CORE ${eventType}`);
        });
      }

      if (eventCategory?.DEBUG) {
        playerManager.addEventListener(eventCategory.DEBUG, (event: any) => {
          const eventType = event?.type ?? 'unknown-debug-event';
          const code = event?.detailedErrorCode ?? event?.errorCode ?? null;
          this.recordReceiverEvent(`DEBUG ${eventType}`, code ? `code=${code}` : undefined);
        });
      }

      const controls = window.cast?.framework?.ui?.Controls?.getInstance?.();
      if (controls?.clearDefaultSlotAssignments) {
        controls.clearDefaultSlotAssignments();
        this.recordReceiverEvent('Disabled default cast-media-player overlay controls');
      }

      context.addCustomMessageListener(DR_TV_CUSTOM_NAMESPACE, (event: any) => {
        const senderId = event?.senderId;
        if (typeof senderId === 'string' && senderId.trim()) {
          this.connectedSenderIds.add(senderId);
        }

        const sessionUpdate = this.parseSessionUpdateMessage(event?.data);
        if (sessionUpdate) {
          this.applySessionUpdate(sessionUpdate);
          return;
        }

        const skipMessage = this.parseSkipTimeCodeMessage(event?.data);
        if (skipMessage) {
          this.handleSkipTimeCodeRequest(skipMessage, playerManager);
          return;
        }

        this.pushLog('Ignoring invalid custom channel payload');
      });

      playerManager.setMessageInterceptor(MessageType.LOAD, async (loadRequestData: any) => {
        this.hasSenderConnected.set(true);
        this.updateUiState();
        this.recordReceiverEvent('Received LOAD message');
        this.pushLog('contentId: ' + loadRequestData?.media?.contentId);
        this.pushLog('contentUrl: ' + (loadRequestData?.media?.contentUrl ?? '(not set)'));
        this.pushLog('contentType: ' + loadRequestData?.media?.contentType);
        this.pushLog('streamType: ' + loadRequestData?.media?.streamType);
        try {
          const mediaJson = JSON.stringify({
            contentId: loadRequestData?.media?.contentId,
            contentUrl: loadRequestData?.media?.contentUrl,
            contentType: loadRequestData?.media?.contentType,
            streamType: loadRequestData?.media?.streamType,
            customData: loadRequestData?.media?.customData,
          });
          this.pushLog('media JSON: ' + mediaJson.slice(0, 300));
        } catch { /* ignore */ }
        this.nextItemTitle.set(null);
        this.nextItemThumbnail.set(null);
        this.clearSkipTimeCodeState();
        this.showNextUp.set(false);

        try {
          const payload = loadRequestData?.customData?.queue ?? loadRequestData?.media?.customData?.queue ?? null;
          if (payload && payload.items) {
            this.queueStatus.set(payload.status ?? 'idle');
            const selectedId = loadRequestData?.customData?.selectedItemId ?? loadRequestData?.media?.customData?.selectedItemId ?? payload.activeItemId ?? payload.items?.[0]?.id ?? null;
            const selectedItem = (payload.items || []).find((i: any) => i.id === selectedId) || payload.items?.[0];
            this.storedQueueItems = payload.items || [];
            if (selectedItem) {
              this.receiverError.set(null);
              const resolvedPlayback = await this.resolvePlaybackFromQueueItem(selectedItem, loadRequestData);

              this.storedActiveItemId = selectedItem.id;
              this.title.set(resolvedPlayback.title || selectedItem.title || 'Untitled');
              this.subtitle.set(resolvedPlayback.subtitle || selectedItem.subtitle || selectedItem.url || '');
              this.pushLog('Showing queue item: ' + (selectedItem.title || selectedItem.id));

              if (resolvedPlayback.posterUrl) {
                selectedItem.posterUrl = resolvedPlayback.posterUrl;
              }

              this.applyResolvedPlaybackToLoadRequest(loadRequestData, resolvedPlayback);
              this.activeSkipTimeCode = resolvedPlayback.skipTimeCode ?? null;
              this.lastSkipAvailabilityVisible = null;
              this.updateSkipAvailabilityForCurrentTime(loadRequestData?.currentTime ?? 0);
              this.pushLog('Set contentUrl from resolved playback: ' + resolvedPlayback.streamUrl);

              // Find and display next item
              const selectedIndex = (payload.items || []).findIndex((i: any) => i.id === selectedItem.id);
              const nextItem = selectedIndex >= 0 && selectedIndex < (payload.items || []).length - 1
                ? payload.items[selectedIndex + 1]
                : null;

              if (nextItem) {
                const nextItemPreview = await this.resolveQueueItemPreview(nextItem, loadRequestData);
                this.nextItemTitle.set(nextItemPreview.title || 'Untitled');
                this.nextItemThumbnail.set(nextItemPreview.thumbnail || nextItem.posterUrl || null);
                nextItem.posterUrl = nextItemPreview.thumbnail || nextItem.posterUrl || null;
                this.updateNextUpVisibility();
                this.pushLog('Next item queued: ' + (nextItem.title || nextItem.id));
              } else {
                this.nextItemTitle.set(null);
                this.nextItemThumbnail.set(null);
                this.showNextUp.set(false);
              }
            }
          } else if (loadRequestData?.media?.customData?.selectedItemTitle) {
            const t = loadRequestData.media.customData.selectedItemTitle;
            this.title.set(t || 'Untitled');
            this.subtitle.set(loadRequestData.media?.contentId || '');
            this.queueStatus.set('playing');
            this.nextItemTitle.set(null);
            this.nextItemThumbnail.set(null);
            this.showNextUp.set(false);
            this.pushLog('Showing media.customData.selectedItemTitle: ' + t);
          } else if (loadRequestData?.media) {
            this.title.set(loadRequestData.media?.metadata?.title || 'Playing media');
            this.subtitle.set(loadRequestData.media?.metadata?.subtitle || loadRequestData.media?.contentId || '');
            this.queueStatus.set('playing');
            this.nextItemTitle.set(null);
            this.nextItemThumbnail.set(null);
            this.showNextUp.set(false);
            this.pushLog('Showing media.metadata title');
          }
        } catch (e: any) {
          const message = e?.message ?? String(e);
          this.receiverError.set(message);
          this.updateDebugState({ lastError: message });
          this.pushLog('Error processing LOAD message: ' + message);
          throw e;
        }

        return loadRequestData;
      });

      const EventType = window.cast.framework.events.EventType;
      playerManager.addEventListener(EventType.ENDED, () => {
        this.clearSkipTimeCodeState();
        this.recordReceiverEvent('Playback ended');
        this.onCurrentItemEnded(playerManager);
      });
      playerManager.addEventListener(EventType.ERROR, (event: any) => {
        const code = event?.detailedErrorCode ?? event?.errorCode ?? 'unknown';
        const reason = event?.reason ?? '';
        const message = `Playback error (${code})${reason ? `: ${reason}` : ''}`;
        this.receiverError.set(message);
        this.updateDebugState({ lastError: message, lastEvent: 'Playback error event' });
        this.pushLog(`PLAYBACK ERROR: code=${code}${reason ? ' reason=' + reason : ''}`);
      });
      playerManager.addEventListener(EventType.MEDIA_STATUS, (event: any) => {
        const playerState = event?.mediaStatus?.playerState ?? 'unknown';
        this.recordReceiverEvent('Player state', playerState);
        this.updateDebugState({ playerState });
        if (playerState === 'PLAYING') {
          this.receiverError.set(null);
          this.updateDebugState({ lastError: null });
        }
        this.isPlaying.set(playerState === 'PLAYING' || playerState === 'BUFFERING' || playerState === 'LOADING');
        this.updateUiState();
        if (playerState === 'PAUSED') {
          this.setProgressBarLogoVisible(true);
        } else if (playerState === 'PLAYING' || playerState === 'BUFFERING' || playerState === 'LOADING') {
          this.showProgressBarLogo.set(true);
          if (this.controlsHideTimer !== null) {
            clearTimeout(this.controlsHideTimer);
          }
          this.controlsHideTimer = setTimeout(() => {
            this.showProgressBarLogo.set(false);
            this.controlsHideTimer = null;
          }, CONTROLS_HIDE_DELAY_MS);
        } else {
          this.setProgressBarLogoVisible(false);
        }
      });
      playerManager.addEventListener(EventType.TIME_UPDATE, () => {
        const current = playerManager.getCurrentTimeSec();
        const duration = playerManager.getDurationSec();
        this.currentTimeSec.set(current ?? 0);
        this.durationSec.set(duration ?? 0);
        this.updateSkipAvailabilityForCurrentTime(current ?? 0);
        this.updateNextUpVisibility(current ?? 0, duration ?? 0);
      });
      playerManager.addEventListener(EventType.PLAYER_LOAD_COMPLETE, () => {
        try {
          const textTracksManager = playerManager.getTextTracksManager?.();
          if (!textTracksManager) {
            return;
          }

          if (this.pendingSubtitleTrackIds.length === 0) {
            textTracksManager.setActiveByIds?.([]);
            return;
          }

          if (!this.pendingSubtitlesEnabled) {
            textTracksManager.setActiveByIds?.([]);
            this.recordReceiverEvent('Subtitle tracks available but disabled');
            return;
          }

          const activeIds = textTracksManager.getActiveIds?.() ?? [];
          if (activeIds.length > 0) {
            return;
          }

          textTracksManager.setActiveByIds?.([this.pendingSubtitleTrackIds[0]]);
          this.recordReceiverEvent('Subtitle track activated', String(this.pendingSubtitleTrackIds[0]));
        } catch (error: any) {
          this.pushLog('Failed to activate subtitle track: ' + (error?.message ?? String(error)));
        }
      });
      context.start();
      this.recordReceiverEvent('Receiver context started');
    } catch (e: any) {
      this.pushLog('Receiver initialize error: ' + (e?.message ?? String(e)));
    }
  }

  private async onCurrentItemEnded(playerManager: any): Promise<void> {
    const items = this.storedQueueItems;
    const currentIndex = items.findIndex((i: any) => i.id === this.storedActiveItemId);
    const nextItem = currentIndex >= 0 && currentIndex < items.length - 1
      ? items[currentIndex + 1]
      : null;

    if (!nextItem) {
      this.queueStatus.set('idle');
      this.nextItemTitle.set(null);
      this.nextItemThumbnail.set(null);
      this.clearSkipTimeCodeState();
      this.updateUiState();
      this.pushLog('Queue finished');
      return;
    }

    const resolvedPlayback = await this.resolvePlaybackFromQueueItem(nextItem);
    this.receiverError.set(null);
    this.activeSkipTimeCode = resolvedPlayback.skipTimeCode ?? null;
    this.lastSkipAvailabilityVisible = null;
    this.updateSkipAvailabilityForCurrentTime(0);

    this.storedActiveItemId = nextItem.id;
    this.title.set(resolvedPlayback.title || nextItem.title || 'Untitled');
    this.subtitle.set(resolvedPlayback.subtitle || nextItem.subtitle || nextItem.url || '');
    this.queueStatus.set('playing');
    this.showNextUp.set(false);

    if (resolvedPlayback.posterUrl) {
      nextItem.posterUrl = resolvedPlayback.posterUrl;
    }

    const nextNextItem = currentIndex + 2 < items.length ? items[currentIndex + 2] : null;
    if (nextNextItem) {
      const nextPreview = await this.resolveQueueItemPreview(nextNextItem);
      this.nextItemTitle.set(nextPreview.title ?? null);
      this.nextItemThumbnail.set(nextPreview.thumbnail ?? nextNextItem.posterUrl ?? null);
      nextNextItem.posterUrl = nextPreview.thumbnail ?? nextNextItem.posterUrl ?? null;
      this.updateNextUpVisibility();
    } else {
      this.nextItemTitle.set(null);
      this.nextItemThumbnail.set(null);
      this.showNextUp.set(false);
    }

    try {
      const loadReq = new window.cast.framework.messages.LoadRequestData();
      loadReq.media = new window.cast.framework.messages.MediaInformation();
      this.applyResolvedPlaybackToLoadRequest(loadReq, resolvedPlayback);
      playerManager.load(loadReq);
      this.pushLog('Auto-advancing to: ' + (nextItem.title || nextItem.id));
    } catch (e: any) {
      const message = e?.message ?? String(e);
      this.receiverError.set(message);
      this.pushLog('Error auto-advancing queue: ' + message);
    }
  }
}