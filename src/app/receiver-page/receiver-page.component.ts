import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, OnInit, signal } from '@angular/core';
import { environment } from '../environments/environment';
import { ReceiverDebugState, ReceiverUiState } from '../models/receiver-ui.model';
import { ResolvedPlayback } from '../models/playback.model';
import { ManifestInfo, TrackingManager, TrackingPlaybackContext, TrackingPlayerState } from '../tracking';
import {
  PlaybackConfigService,
  enrichMediaStatus,
  SessionManager,
  ConfigLoader,
  PlaybackResolver,
  PlaybackDataMapper,
  BreakUISuppressor,
  ReceiverLogger,
} from '../services';

/**
 * Main CAF Web Receiver component.
 *
 * Bootstraps the Google Cast Application Framework (CAF v3), wires all player
 * lifecycle events, and delegates domain concerns to focused service classes.
 *
 * Responsibilities:
 * - Load the CAF receiver framework script on init
 * - Fetch receiver configuration and propagate feature flags to tracking
 * - Wire CAF system events (SENDER_CONNECTED/DISCONNECTED)
 * - Intercept LOAD messages to resolve playback via {@link PlaybackResolver}
 * - Handle custom-channel session updates via {@link SessionManager}
 * - Drive subtitle track activation after {@link EventType.PLAYER_LOAD_COMPLETE}
 * - Advance the queue when playback ends
 * - Suppress CAF break overlay UI via {@link BreakUISuppressor}
 */
@Component({
  selector: 'app-receiver-page',
  imports: [CommonModule],
  templateUrl: './receiver-page.component.html',
  styleUrl: './receiver-page.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ReceiverPageComponent implements OnInit, AfterViewInit, OnDestroy {
  /** CAF framework script URL for dynamic bootstrapping. */
  private readonly castReceiverScriptUrl = environment.receiver.castReceiverScriptUrl;
  /** Throttle interval for noisy debug overlay events. */
  private readonly debugEventThrottleMs = environment.receiver.debugEventThrottleMs;
  /** Enables/disables debug overlay rendering. */
  private readonly showDebugOverlayEnabled = environment.receiver.showDebugOverlay;
  /** URL for receiver config bootstrap API. */
  private readonly configEndpointUrl = environment.receiver.configEndpointUrl;
  /** Custom namespace for sender/receiver custom channel messages. */
  private readonly customNamespace = environment.receiver.customNamespace;

  /** Semantic version displayed in the debug overlay. */
  protected readonly appVersion = signal('0.0.24');
  /** Controls whether the debug overlay panel is rendered. */
  protected readonly showDebugOverlay = this.showDebugOverlayEnabled;
  /** Primary content title shown in the receiver UI. */
  protected readonly title = signal('Waiting for content');
  /** Secondary subtitle shown beneath the title. */
  protected readonly subtitle = signal('Idle');
  /** Fatal error message surfaced to the debug overlay. */
  protected readonly receiverError = signal<string | null>(null);
  /** High-level receiver UI state driving template visibility. */
  protected readonly uiState = signal<ReceiverUiState>('awaiting-cast');
  /** True once at least one Cast sender has connected this session. */
  protected readonly hasSenderConnected = signal(false);
  /** Queue playback status string passed through from the sender payload. */
  protected readonly queueStatus = signal<string>('idle');
  /** True while the player is in PLAYING, BUFFERING, or LOADING state. */
  protected readonly isPlaying = signal(false);
  /** Raw receiver config response stored for debug inspection. */
  protected readonly configResponse = signal<unknown | null>(null);
  /** Timestamped log entries shown in the debug overlay (max 200). */
  protected readonly logs = signal<string[]>([]);
  /** Detailed debug state object rendered in the debug overlay. */
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
    skipTimeCode: null,
  });

  /** All queue items received from the last LOAD message. */
  private storedQueueItems: any[] = [];
  /** ID of the currently active queue item, used to advance to the next item. */
  private storedActiveItemId: string | null = null;
  /** Epoch timestamp of the last debug overlay event (used for throttling). */
  private lastDebugOverlayEventAt = 0;
  /** Last event string written to the debug overlay (deduplication guard). */
  private lastDebugOverlayEvent: string | null = null;
  /** Track IDs pending activation after PLAYER_LOAD_COMPLETE. */
  private pendingSubtitleTrackIds: number[] = [];
  /** Whether subtitles should be auto-activated after load. */
  private pendingSubtitlesEnabled = false;
  /** setInterval handle for the shadow-root break UI watcher. */
  private breakInfoHideIntervalId: number | null = null;
  /** MutationObserver watching the player shadow root for break UI changes. */
  private breakInfoObserver: MutationObserver | null = null;
  /** The last observed player shadow root (used to detect root replacement). */
  private observedPlayerShadowRoot: ShadowRoot | null = null;
  /** Coordinates Segment and NPAW tracking across the playback lifecycle. */
  private readonly trackingManager = new TrackingManager({
    appName: 'DRTV_chromecast',
    appVersion: this.appVersion(),
    isPreprod: typeof window !== 'undefined' && /test|preprod/i.test(window.location.hostname),
  });
  /** Parsed HLS manifest metadata; replaced on each LOAD to reset live offset. */
  private manifestInfo = new ManifestInfo();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly configLoader: ConfigLoader,
    private readonly playbackResolver: PlaybackResolver,
    private readonly playbackDataMapper: PlaybackDataMapper,
    private readonly breakUISuppressor: BreakUISuppressor,
    private readonly receiverLogger: ReceiverLogger,
    private readonly playbackConfigService: PlaybackConfigService,
  ) {}

  /**
   * Initialises the receiver:
   * 1. Fetches receiver configuration and updates tracking feature flags.
   * 2. Loads the CAF Web Receiver framework script.
   * 3. Wires all CAF event listeners and message interceptors.
   */
  async ngOnInit(): Promise<void> {
    this.pushLog('Receiver booting');
    this.receiverError.set(null);
    try {
      await this.configLoader.loadConfig(this.configEndpointUrl);
      const configJson = this.configLoader.getConfigResponse();
      this.trackingManager.updateFeatureFlags(this.configLoader.extractTrackingFeatureFlags(configJson));
      await this.loadReceiverFramework();
      this.pushLog('CAF framework loaded');
      this.initializeReceiver();
    } catch (err: any) {
      const message = err?.message ?? String(err);
      this.receiverError.set(message);
      this.updateDebugState({ lastError: message });
      this.pushLog('Receiver initialization failed: ' + message);
    }
  }

  /** Loads the CAF receiver framework script if it is not already available. */
  private loadReceiverFramework(): Promise<void> {
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
      script.src = this.castReceiverScriptUrl;
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

  /** Cleans up the break UI watcher interval and destroys the tracking manager. */
  ngOnDestroy(): void {
    this.stopBreakInfoHider();
    this.trackingManager.destroy();
  }

  /** Starts the break UI watcher after the view is initialised. */
  ngAfterViewInit(): void {
    this.startBreakInfoHider();
  }

  /**
   * Starts a 500 ms polling interval that finds the CAF player shadow root and
   * attaches a {@link MutationObserver} to suppress break UI on every DOM change.
   */
  private startBreakInfoHider(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    if (this.breakInfoHideIntervalId !== null) {
      window.clearInterval(this.breakInfoHideIntervalId);
      this.breakInfoHideIntervalId = null;
    }

    const syncShadowRootWatcher = (): void => {
      const player = document.getElementById('player');
      const shadowRoot = (player as HTMLElement | null)?.shadowRoot ?? null;

      if (!shadowRoot) {
        return;
      }

      if (this.observedPlayerShadowRoot !== shadowRoot) {
        this.breakInfoObserver?.disconnect();
        this.observedPlayerShadowRoot = shadowRoot;
        this.breakInfoObserver = new MutationObserver(() => {
          this.hideBreakInfoInShadowRoot(shadowRoot);
        });
        this.breakInfoObserver.observe(shadowRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style'],
        });
      }

      this.hideBreakInfoInShadowRoot(shadowRoot);
    };

    syncShadowRootWatcher();
    this.breakInfoHideIntervalId = window.setInterval(syncShadowRootWatcher, 500);
  }

  /** Clears the break UI polling interval and disconnects the MutationObserver. */
  private stopBreakInfoHider(): void {
    if (typeof window !== 'undefined' && this.breakInfoHideIntervalId !== null) {
      window.clearInterval(this.breakInfoHideIntervalId);
    }

    this.breakInfoHideIntervalId = null;
    this.breakInfoObserver?.disconnect();
    this.breakInfoObserver = null;
    this.observedPlayerShadowRoot = null;
  }

  /**
   * Delegates break UI suppression to {@link BreakUISuppressor}.
   * Called by the shadow root watcher on every observed DOM mutation.
   */
  private hideBreakInfoInShadowRoot(shadowRoot: ShadowRoot): void {
    this.breakUISuppressor.hideBreakUI(shadowRoot);
  }

  /**
   * Derives the UI state from playback and sender-connection signals.
   * State transitions: `awaiting-cast` → `connected-idle` → `playing`.
   */
  private updateUiState(): void {
    const isPlaying = this.isPlaying();
    const hasSenderConnected = this.hasSenderConnected();
    
    if (isPlaying) {
      this.uiState.set('playing');
      return;
    }

    if (hasSenderConnected) {
      this.uiState.set('connected-idle');
      return;
    }

    this.uiState.set('awaiting-cast');
  }

  /**
   * Writes a timestamped message to both the {@link ReceiverLogger} and the
   * local `logs` signal that drives the debug overlay.
   *
   * @param message - Plain-text message to record.
   */
  private pushLog(message: string): void {
    this.receiverLogger.log(message);
    this.logs.update((current) => [
      `[${new Date().toLocaleTimeString()}] ${message}`,
      ...current
    ].slice(0, 200));
  }

  /**
   * Merges a partial patch into the `debugState` signal.
   *
   * @param patch - Partial debug state to merge.
   */
  private updateDebugState(patch: Partial<ReceiverDebugState>): void {
    this.debugState.update((current) => ({
      ...current,
      ...patch,
    }));
  }

  /**
   * Logs a receiver event and conditionally updates the debug overlay.
  * Noisy `CORE` and `DEBUG` events are throttled by {@link debugEventThrottleMs}.
   * Consecutive identical events are de-duplicated.
   *
   * @param eventName - Short event label.
   * @param details   - Optional detail string appended after a colon.
   */
  private recordReceiverEvent(eventName: string, details?: string): void {
    const summary = details ? `${eventName}: ${details}` : eventName;
    this.pushLog(summary);

    if (!this.showDebugOverlay) {
      return;
    }

    const isNoisyEvent = summary.startsWith('CORE ') || summary.startsWith('DEBUG ');
    const now = Date.now();
    if (isNoisyEvent && now - this.lastDebugOverlayEventAt < this.debugEventThrottleMs) {
      return;
    }

    if (summary === this.lastDebugOverlayEvent) {
      return;
    }

    this.lastDebugOverlayEvent = summary;
    this.lastDebugOverlayEventAt = now;
    this.updateDebugState({ lastEvent: summary });
  }

  /**
   * Maps a CAF player state string to the {@link TrackingPlayerState} union.
   *
   * @param playerState - Raw CAF player state (e.g. `'PLAYING'`).
   * @returns Typed tracking player state, or `'UNKNOWN'` for unrecognised values.
   */
  private toTrackingPlayerState(playerState: string): TrackingPlayerState {
    if (playerState === 'PLAYING') {
      return 'PLAYING';
    }

    if (playerState === 'PAUSED') {
      return 'PAUSED';
    }

    if (playerState === 'BUFFERING') {
      return 'BUFFERING';
    }

    if (playerState === 'LOADING') {
      return 'LOADING';
    }

    if (playerState === 'IDLE') {
      return 'IDLE';
    }

    return 'UNKNOWN';
  }

  /**
   * Builds a {@link TrackingPlaybackContext} from a resolved playback and the
   * original queue item / LOAD request so tracking has all available metadata.
   *
   * @param resolvedPlayback - Stream resolution result.
   * @param selectedItem     - Raw queue item from the sender payload.
   * @param loadRequestData  - Full CAF LoadRequestData including customData.
   */
  private toTrackingPlaybackFromResolved(
    resolvedPlayback: ResolvedPlayback,
    selectedItem: any,
    loadRequestData: any,
  ): TrackingPlaybackContext {
    const customData = loadRequestData?.customData ?? loadRequestData?.media?.customData ?? {};

    return {
      itemId: resolvedPlayback.itemId ?? selectedItem?.id ?? null,
      title: resolvedPlayback.title ?? selectedItem?.title,
      subtitle: resolvedPlayback.subtitle ?? selectedItem?.subtitle,
      streamUrl: resolvedPlayback.streamUrl,
      mimeType: resolvedPlayback.mimeType,
      durationSeconds: resolvedPlayback.durationSeconds,
      isLive: resolvedPlayback.isLive,
      profileId: typeof customData?.profileID === 'string' ? customData.profileID : undefined,
      consents: Array.isArray(customData?.consents)
        ? customData.consents.filter((consent: unknown): consent is string => typeof consent === 'string')
        : undefined,
      liveAbsoluteTimeSeconds: undefined,
      senderDevice: typeof customData?.deviceType === 'string' ? customData.deviceType : undefined,
      autoPlayReason: typeof customData?.autoPlayReason === 'string' ? customData.autoPlayReason : undefined,
    };
  }

  /**
   * Initialises the CAF CastReceiverContext, attaches all system/player event
   * listeners, registers the LOAD message interceptor, and starts the receiver.
   *
   * Called once after the CAF framework script has loaded successfully.
   */
  private initializeReceiver(): void {
    try {
      const context = window.cast.framework.CastReceiverContext.getInstance();
      const playerManager = context.getPlayerManager();
      void this.trackingManager.initialize(playerManager);

      const playbackConfig = this.playbackConfigService.createPlaybackConfig(this.manifestInfo);
      const options = this.playbackConfigService.createReceiverOptions(playbackConfig, this.customNamespace);

      const MessageType = window.cast.framework.messages.MessageType;
      const eventCategory = window.cast?.framework?.events?.category;

      const systemEventType = window.cast?.framework?.system?.EventType;
      if (systemEventType?.SENDER_CONNECTED) {
        context.addEventListener(systemEventType.SENDER_CONNECTED, () => {
          this.hasSenderConnected.set(true);
          this.updateUiState();
          this.recordReceiverEvent('Sender connected');
        });
      }
      if (systemEventType?.SENDER_DISCONNECTED) {
        context.addEventListener(systemEventType.SENDER_DISCONNECTED, () => {
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

      context.addCustomMessageListener(this.customNamespace, (event: any) => {
        const sessionUpdate = this.sessionManager.parseSessionUpdateMessage(event?.data);
        if (sessionUpdate) {
          this.sessionManager.updateSession(sessionUpdate);
          const session = this.sessionManager.getSession();
          
          this.updateDebugState({
            sessionAccessToken: this.sessionManager.maskToken(session.accessToken || ''),
            sessionIdToken: this.sessionManager.maskToken(session.idToken || ''),
            sessionSegments: [...session.segments],
            sessionAnonymousId: session.anonymousId,
            sessionUpdatedAt: new Date().toISOString(),
          });

          this.recordReceiverEvent(
            'Session updated',
            `segments=${session.segments.length} anonymousId=${session.anonymousId}`,
          );

          void this.trackingManager.updateSession({
            anonymousId: session.anonymousId || '',
            accessToken: session.accessToken || '',
            idToken: session.idToken || '',
            profileId: undefined,
            consents: undefined,
            segments: [...session.segments],
          });
          return;
        }

        this.pushLog('Ignoring invalid custom channel payload');
      });

      playerManager.setMessageInterceptor(MessageType.LOAD, async (loadRequestData: any) => {
        this.manifestInfo = new ManifestInfo();
        this.trackingManager.onStop(playerManager.getCurrentTimeSec?.());
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

        try {
          const payload = loadRequestData?.customData?.queue ?? loadRequestData?.media?.customData?.queue ?? null;
          if (payload && payload.items) {
            this.queueStatus.set(payload.status ?? 'idle');
            const selectedId = loadRequestData?.customData?.selectedItemId ?? loadRequestData?.media?.customData?.selectedItemId ?? payload.activeItemId ?? payload.items?.[0]?.id ?? null;
            const selectedItem = (payload.items || []).find((i: any) => i.id === selectedId) || payload.items?.[0];
            this.storedQueueItems = payload.items || [];
            if (selectedItem) {
              this.receiverError.set(null);
              
              // Update debug state with path info before resolution
              const rawPath = selectedItem?.url ?? selectedItem?.path;
              const normalizedPath = (typeof rawPath === 'string' && rawPath.trim().startsWith('/')) 
                ? rawPath.trim() 
                : `/${typeof rawPath === 'string' ? rawPath.trim() : ''}`;
              const pageUrl = new URL(environment.receiver.pageEndpointBaseUrl);
              pageUrl.searchParams.set('path', normalizedPath);
              this.updateDebugState({
                path: normalizedPath,
                pageUrl: pageUrl.toString(),
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
              
              const resolvedPlayback = await this.playbackResolver.resolve(selectedItem, null);

              this.storedActiveItemId = selectedItem.id;
              this.title.set(resolvedPlayback.title || selectedItem.title || 'Untitled');
              this.subtitle.set(resolvedPlayback.subtitle || selectedItem.subtitle || selectedItem.url || '');
              this.pushLog('Showing queue item: ' + (selectedItem.title || selectedItem.id));

              if (resolvedPlayback.posterUrl) {
                selectedItem.posterUrl = resolvedPlayback.posterUrl;
              }

              this.playbackDataMapper.applyToLoadRequest(loadRequestData, resolvedPlayback);
              this.updateDebugState({
                streamUrl: resolvedPlayback.streamUrl,
                contentType: resolvedPlayback.mimeType,
              });
              this.trackingManager.onLoad(this.toTrackingPlaybackFromResolved(resolvedPlayback, selectedItem, loadRequestData));
              this.updateDebugState({
                skipTimeCode: resolvedPlayback.skipTimeCode
                  ? `${resolvedPlayback.skipTimeCode.timeCodeType} ${resolvedPlayback.skipTimeCode.startTime}-${resolvedPlayback.skipTimeCode.endTime}s`
                  : 'none',
              });
              this.pushLog('Set contentUrl from resolved playback: ' + resolvedPlayback.streamUrl);
            }
          } else if (loadRequestData?.media?.customData?.selectedItemTitle) {
            const t = loadRequestData.media.customData.selectedItemTitle;
            this.title.set(t || 'Untitled');
            this.subtitle.set(loadRequestData.media?.contentId || '');
            this.queueStatus.set('playing');
            this.pushLog('Showing media.customData.selectedItemTitle: ' + t);
            this.trackingManager.onLoad({
              itemId: loadRequestData.media?.contentId,
              title: t,
              subtitle: loadRequestData.media?.contentId || undefined,
              streamUrl: loadRequestData.media?.contentUrl,
              mimeType: loadRequestData.media?.contentType,
              isLive: loadRequestData.media?.streamType === 'LIVE',
              profileId: typeof loadRequestData?.media?.customData?.profileID === 'string'
                ? loadRequestData.media.customData.profileID
                : undefined,
              consents: Array.isArray(loadRequestData?.media?.customData?.consents)
                ? loadRequestData.media.customData.consents.filter((consent: unknown): consent is string => typeof consent === 'string')
                : undefined,
            });
          } else if (loadRequestData?.media) {
            this.title.set(loadRequestData.media?.metadata?.title || 'Playing media');
            this.subtitle.set(loadRequestData.media?.metadata?.subtitle || loadRequestData.media?.contentId || '');
            this.queueStatus.set('playing');
            this.pushLog('Showing media.metadata title');
            this.trackingManager.onLoad({
              itemId: loadRequestData.media?.contentId,
              title: loadRequestData.media?.metadata?.title,
              subtitle: loadRequestData.media?.metadata?.subtitle,
              streamUrl: loadRequestData.media?.contentUrl,
              mimeType: loadRequestData.media?.contentType,
              isLive: loadRequestData.media?.streamType === 'LIVE',
              profileId: typeof loadRequestData?.media?.customData?.profileID === 'string'
                ? loadRequestData.media.customData.profileID
                : undefined,
              consents: Array.isArray(loadRequestData?.media?.customData?.consents)
                ? loadRequestData.media.customData.consents.filter((consent: unknown): consent is string => typeof consent === 'string')
                : undefined,
            });
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
      playerManager.addEventListener(EventType.ENDED, (event: any) => {
        this.recordReceiverEvent('Playback ended');
        this.trackingManager.onCompleted(event?.currentMediaTime ?? playerManager.getCurrentTimeSec?.());
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
        const enrichedStatus = enrichMediaStatus(event, playerManager, this.manifestInfo);

        this.recordReceiverEvent('Player state', enrichedStatus.playerState);
        this.updateDebugState({ playerState: enrichedStatus.playerState });
        this.trackingManager.onPlayerState(
          this.toTrackingPlayerState(enrichedStatus.playerState),
          enrichedStatus.currentTime,
          enrichedStatus.liveAbsoluteTime
        );
        if (enrichedStatus.playerState === 'PLAYING') {
          this.receiverError.set(null);
          this.updateDebugState({ lastError: null });
        }
        this.isPlaying.set(
          enrichedStatus.playerState === 'PLAYING' ||
            enrichedStatus.playerState === 'BUFFERING' ||
            enrichedStatus.playerState === 'LOADING'
        );
        this.updateUiState();
      });
      playerManager.addEventListener(EventType.REQUEST_SEEK, () => {
        this.trackingManager.onSeek(playerManager.getCurrentTimeSec?.());
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
      context.start(options);
      this.recordReceiverEvent('Receiver context started');
    } catch (e: any) {
      this.pushLog('Receiver initialize error: ' + (e?.message ?? String(e)));
    }
  }

  /**
   * Advances the queue to the next item after the current one ends.
   * Resolves playback for the next item, applies it to a new LoadRequest, and
   * calls `playerManager.load()` to trigger seamless continuation.
   *
   * @param playerManager - CAF PlayerManager instance used to trigger the load.
   */
  private async onCurrentItemEnded(playerManager: any): Promise<void> {
    const items = this.storedQueueItems;
    const currentIndex = items.findIndex((i: any) => i.id === this.storedActiveItemId);
    const nextItem = currentIndex >= 0 && currentIndex < items.length - 1
      ? items[currentIndex + 1]
      : null;

    if (!nextItem) {
      this.queueStatus.set('idle');
      this.updateUiState();
      this.pushLog('Queue finished');
      return;
    }

    const resolvedPlayback = await this.playbackResolver.resolve(nextItem);
    this.receiverError.set(null);

    this.storedActiveItemId = nextItem.id;
    this.title.set(resolvedPlayback.title || nextItem.title || 'Untitled');
    this.subtitle.set(resolvedPlayback.subtitle || nextItem.subtitle || nextItem.url || '');
    this.queueStatus.set('playing');
    this.updateDebugState({
      skipTimeCode: resolvedPlayback.skipTimeCode
        ? `${resolvedPlayback.skipTimeCode.timeCodeType} ${resolvedPlayback.skipTimeCode.startTime}-${resolvedPlayback.skipTimeCode.endTime}s`
        : 'none',
    });

    if (resolvedPlayback.posterUrl) {
      nextItem.posterUrl = resolvedPlayback.posterUrl;
    }

    try {
      const loadReq = new window.cast.framework.messages.LoadRequestData();
      loadReq.media = new window.cast.framework.messages.MediaInformation();
      this.playbackDataMapper.applyToLoadRequest(loadReq, resolvedPlayback);
      playerManager.load(loadReq);
      this.pushLog('Auto-advancing to: ' + (nextItem.title || nextItem.id));
    } catch (e: any) {
      const message = e?.message ?? String(e);
      this.receiverError.set(message);
      this.pushLog('Error auto-advancing queue: ' + message);
    }
  }
}