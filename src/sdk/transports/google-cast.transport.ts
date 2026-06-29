import {
  CastCustomNamespaceMessage,
  CastMediaItem,
  CastQueueState,
  CastSessionUpdateMessage,
  CastSkipTimeCodeMessage,
  CastTransport,
  CastUiOverrides,
  defaultCastUiOverrides,
} from '../common/types';
import { cloneQueueState, createReceiverQueuePayload, createSerializableQueuePayload, mergeUiOverrides } from '../common/utils';
import { initializeGoogleCastLauncher } from './google-cast-launcher.init';

const DR_TV_CUSTOM_NAMESPACE = 'urn:x-cast:dk.dr.tv.chromecast';

type GoogleCastMediaNamespace = {
  MediaInfo: new (contentId: string, contentType: string) => unknown;
  GenericMediaMetadata: new () => { title?: string; subtitle?: string; images?: unknown[] };
  Image: new (url: string) => unknown;
  LoadRequest: new (mediaInfo: unknown) => { autoplay?: boolean; customData?: Record<string, unknown> };
  EditTracksInfoRequest?: new (activeTrackIds: number[]) => { activeTrackIds?: number[] };
  StreamType?: {
    BUFFERED?: unknown;
    OTHER?: unknown;
    LIVE?: unknown;
  };
};

type GoogleCastSession = {
  loadMedia?: (request: unknown) => Promise<void> | void;
  getMediaSession?: () => GoogleCastMediaSession | null;
  sendMessage?: (
    namespace: string,
    message: unknown,
    successCallback?: () => void,
    errorCallback?: (error: unknown) => void,
  ) => Promise<void> | void;
  addMessageListener?: (namespace: string, listener: (namespace: string, message: unknown) => void) => void;
};

type GoogleCastMediaSession = {
  activeTrackIds?: number[] | null;
  editTracksInfo?: (request: unknown, successCallback?: () => void, errorCallback?: (error: unknown) => void) => Promise<void> | void;
  media?: {
    tracks?: Array<{ trackId?: number; type?: string }> | null;
  } | null;
};

type GoogleCastRemotePlayer = object;

type GoogleCastFramework = {
  CastContext: {
    getInstance: () => {
      getCurrentSession: () => GoogleCastSession | null;
      requestSession: () => Promise<void>;
    };
  };
  RemotePlayer: new () => GoogleCastRemotePlayer;
  RemotePlayerController: new (player: GoogleCastRemotePlayer) => {
    playOrPause: () => void;
    stop: () => void;
  };
};

type ChromeCastWindow = Window & {
  cast?: {
    framework?: GoogleCastFramework;
  };
  chrome?: {
    cast?: {
      media?: GoogleCastMediaNamespace;
    };
  };
};

function getChromeCastWindow(): ChromeCastWindow | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window as ChromeCastWindow;
}

function getScriptUrl(): string {
  return 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
}

function loadScriptOnce(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Document is not available in this environment.'));
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-cast-sdk="true"]');
    if (existingScript) {
      if (existingScript.dataset['loaded'] === 'true') {
        resolve();
        return;
      }

      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Cast sender SDK.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = url;
    script.dataset['castSdk'] = 'true';
    script.addEventListener(
      'load',
      () => {
        script.dataset['loaded'] = 'true';
        resolve();
      },
      { once: true }
    );
    script.addEventListener('error', () => reject(new Error('Failed to load Google Cast sender SDK.')), { once: true });
    document.head.appendChild(script);
  });
}

function getCastContext(chromeCastWindow: ChromeCastWindow): ReturnType<GoogleCastFramework['CastContext']['getInstance']> | null {
  return chromeCastWindow.cast?.framework?.CastContext.getInstance() ?? null;
}

async function obtainCastSession(castContext: ReturnType<GoogleCastFramework['CastContext']['getInstance']>): Promise<GoogleCastSession | null> {
  console.log('[obtainCastSession] Starting...');
  const immediateSession = castContext.getCurrentSession();
  console.log('[obtainCastSession] Immediate session:', Boolean(immediateSession));
  if (immediateSession) {
    return immediateSession;
  }

  try {
    console.log('[obtainCastSession] Calling requestSession()...');
    await castContext.requestSession();
    console.log('[obtainCastSession] requestSession() completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[obtainCastSession] requestSession() failed:', message);
    throw new Error(`Failed to request Cast session: ${message}`);
  }

  let session = castContext.getCurrentSession();
  console.log('[obtainCastSession] Session after requestSession():', Boolean(session));
  if (session) {
    return session;
  }

  const retries = [250, 500];
  for (const waitMs of retries) {
    console.log(`[obtainCastSession] Waiting ${waitMs}ms before retry...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    session = castContext.getCurrentSession();
    console.log(`[obtainCastSession] Session after ${waitMs}ms wait:`, Boolean(session));
    if (session) {
      return session;
    }
  }

  throw new Error('No active Cast session was created after requestSession().');
}

function createMediaInfo(item: CastMediaItem, chromeCastWindow: ChromeCastWindow): unknown {
  const mediaNamespace = chromeCastWindow.chrome?.cast?.media;
  if (!mediaNamespace) {
    return null;
  }

  const mediaInfo = new mediaNamespace.MediaInfo(item.url, item.mimeType) as {
    contentUrl?: string;
    metadata?: { title?: string; subtitle?: string; images?: unknown[] };
    customData?: Record<string, unknown>;
    streamType?: unknown;
  };
  mediaInfo.contentUrl = item.url;
  const metadata = new mediaNamespace.GenericMediaMetadata();
  metadata.title = item.title;
  if (item.subtitle) {
    metadata.subtitle = item.subtitle;
  }
  if (item.posterUrl && typeof mediaNamespace.Image === 'function') {
    try {
      metadata.images = [new mediaNamespace.Image(item.posterUrl)];
    } catch (error) {
      console.warn('Failed to create Cast Image object for posterUrl:', error);
    }
  }

  mediaInfo.metadata = metadata;
  const isHls = item.mimeType === 'application/x-mpegURL' || item.mimeType === 'application/vnd.apple.mpegurl';
  mediaInfo.streamType = isHls
    ? (mediaNamespace.StreamType?.BUFFERED ?? 'BUFFERED')
    : (mediaNamespace.StreamType?.BUFFERED ?? 'BUFFERED');
  return mediaInfo;
}

function createLoadRequest(item: CastMediaItem, state: CastQueueState, chromeCastWindow: ChromeCastWindow): unknown {
  const mediaNamespace = chromeCastWindow.chrome?.cast?.media;
  if (!mediaNamespace) {
    return null;
  }

  const mediaInfo = createMediaInfo(item, chromeCastWindow);
  if (!mediaInfo) {
    return null;
  }

  const request = new mediaNamespace.LoadRequest(mediaInfo);
  const serializablePayload = createSerializableQueuePayload(state);
  const queueData = serializablePayload['queue'] as { items: Array<{ id: string }> };
  request.autoplay = true;
  request.customData = {
    ...serializablePayload,
    queueIds: queueData.items.map((queueItem) => queueItem.id),
    selectedItemId: item.id,
    selectedItemTitle: item.title,
  };
  (mediaInfo as { customData?: Record<string, unknown> }).customData = {
    ...(item.customData ?? {}),
    ...serializablePayload,
    selectedItemId: item.id,
    selectedItemTitle: item.title,
  };
  return request;
}

export class GoogleCastTransport implements CastTransport {
  readonly name = 'Google Cast SDK';
  readonly isSupported = true;

  private uiOverrides: CastUiOverrides | null = null;
  private readonly scriptUrl: string;
  private lastQueue: CastQueueState | null = null;
  private receiverMessageListener: ((payload: CastCustomNamespaceMessage) => void) | null = null;
  private hasSessionMessageListener = false;

  constructor(scriptUrl: string = getScriptUrl()) {
    this.scriptUrl = scriptUrl;
  }

  async connect(state: CastQueueState): Promise<void> {
    const chromeCastWindow = getChromeCastWindow();
    if (!chromeCastWindow) {
      throw new Error('Google Cast sender SDK requires a browser window.');
    }

    console.log('[GoogleCastTransport.connect] Starting connection...');

    await loadScriptOnce(this.scriptUrl);
    console.log('[GoogleCastTransport.connect] Script loaded');

    const isInitialized = await initializeGoogleCastLauncher();
    console.log('[GoogleCastTransport.connect] Launcher initialized:', isInitialized);
    if (!isInitialized) {
      throw new Error('Google Cast framework did not initialize.');
    }

    const castContext = getCastContext(chromeCastWindow);
    console.log('[GoogleCastTransport.connect] Got cast context:', Boolean(castContext));
    if (!castContext) {
      throw new Error('Google Cast context is not available.');
    }

    try {
      const urlAppId = new URLSearchParams(chromeCastWindow.location.search).get('castAppId') ?? null;
      const sdkDefault = (chromeCastWindow as any).chrome?.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID ?? null;
      const resolvedAppId = urlAppId ?? sdkDefault ?? 'unknown';
      console.log(`[${new Date().toLocaleTimeString()}] GoogleCastTransport: requesting session for appId=${resolvedAppId}`);
    } catch (e) {
      // ignore logging errors in environments that restrict URL access
    }

    console.log('[GoogleCastTransport.connect] Calling obtainCastSession...');
    const session = await obtainCastSession(castContext);
    console.log('[GoogleCastTransport.connect] obtainCastSession returned:', Boolean(session));
    if (!session) {
      throw new Error('No active Cast session was created.');
    }

    console.log('[GoogleCastTransport.connect] Setting up message listener');
    this.ensureCustomNamespaceListener(session);

    this.lastQueue = cloneQueueState(state);
    console.log('[GoogleCastTransport.connect] Connection complete');
  }

  async loadQueue(state: CastQueueState): Promise<void> {
    const chromeCastWindow = getChromeCastWindow();
    if (!chromeCastWindow) {
      throw new Error('Google Cast sender SDK requires a browser window.');
    }

    await loadScriptOnce(this.scriptUrl);
    const isInitialized = await initializeGoogleCastLauncher();
    if (!isInitialized) {
      throw new Error('Google Cast framework did not initialize.');
    }

    const castContext = getCastContext(chromeCastWindow);
    const session = castContext?.getCurrentSession() ?? null;
    if (!session?.loadMedia) {
      throw new Error('Connect to a Cast receiver before sending queue.');
    }

    this.ensureCustomNamespaceListener(session);

    this.lastQueue = cloneQueueState(state);

    const itemToLoad = state.items.find((item) => item.id === state.activeItemId) ?? state.items[0] ?? null;
    if (!itemToLoad) {
      return;
    }

    const request = createLoadRequest(itemToLoad, state, chromeCastWindow);
    if (!request) {
      throw new Error('Could not create Google Cast media request.');
    }

    await session.loadMedia(request);
  }

  async play(item: CastMediaItem, state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
    const chromeCastWindow = getChromeCastWindow();
    if (!chromeCastWindow) {
      throw new Error('Google Cast sender SDK requires a browser window.');
    }

    await loadScriptOnce(this.scriptUrl);
    const isInitialized = await initializeGoogleCastLauncher();
    if (!isInitialized) {
      throw new Error('Google Cast framework did not initialize.');
    }

    const castContext = getCastContext(chromeCastWindow);
    const session = castContext?.getCurrentSession() ?? null;
    if (!session?.loadMedia) {
      throw new Error('Connect to a Cast receiver before starting playback.');
    }

    this.ensureCustomNamespaceListener(session);

    const request = createLoadRequest(item, state, chromeCastWindow);
    if (!request) {
      throw new Error('Could not create Google Cast media request.');
    }

    await session.loadMedia(request);
  }

  async sendSessionUpdate(payload: CastSessionUpdateMessage): Promise<void> {
    const chromeCastWindow = getChromeCastWindow();
    if (!chromeCastWindow) {
      throw new Error('Google Cast sender SDK requires a browser window.');
    }

    await loadScriptOnce(this.scriptUrl);
    const isInitialized = await initializeGoogleCastLauncher();
    if (!isInitialized) {
      throw new Error('Google Cast framework did not initialize.');
    }

    const castContext = getCastContext(chromeCastWindow);
    const session = castContext?.getCurrentSession() ?? null;
    if (!session?.sendMessage) {
      throw new Error('Connect to a Cast receiver before sending session updates.');
    }

    this.ensureCustomNamespaceListener(session);

    await new Promise<void>((resolve, reject) => {
      try {
        const maybePromise = session.sendMessage?.(
          DR_TV_CUSTOM_NAMESPACE,
          payload,
          () => resolve(),
          (error: unknown) => reject(error instanceof Error ? error : new Error(String(error)))
        );

        if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
          (maybePromise as Promise<void>).then(resolve).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async sendSkipTimeCode(payload: CastSkipTimeCodeMessage): Promise<void> {
    const chromeCastWindow = getChromeCastWindow();
    if (!chromeCastWindow) {
      throw new Error('Google Cast sender SDK requires a browser window.');
    }

    await loadScriptOnce(this.scriptUrl);
    const isInitialized = await initializeGoogleCastLauncher();
    if (!isInitialized) {
      throw new Error('Google Cast framework did not initialize.');
    }

    const castContext = getCastContext(chromeCastWindow);
    const session = castContext?.getCurrentSession() ?? null;
    if (!session?.sendMessage) {
      throw new Error('Connect to a Cast receiver before sending skip commands.');
    }

    this.ensureCustomNamespaceListener(session);

    await new Promise<void>((resolve, reject) => {
      try {
        const maybePromise = session.sendMessage?.(
          DR_TV_CUSTOM_NAMESPACE,
          payload,
          () => resolve(),
          (error: unknown) => reject(error instanceof Error ? error : new Error(String(error)))
        );

        if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
          (maybePromise as Promise<void>).then(resolve).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async pause(state: CastQueueState): Promise<void> {
    const chromeCastWindow = getChromeCastWindow();
    const fw = chromeCastWindow?.cast?.framework;
    console.log('[GoogleCastTransport] pause — RemotePlayer:', typeof fw?.RemotePlayer, 'RemotePlayerController:', typeof fw?.RemotePlayerController);
    if (fw?.RemotePlayer && fw?.RemotePlayerController) {
      try {
        const controller = new fw.RemotePlayerController(new fw.RemotePlayer());
        controller.playOrPause();
        console.log('[GoogleCastTransport] playOrPause() dispatched');
      } catch (e) {
        console.warn('[GoogleCastTransport] pause via RemotePlayerController failed:', e);
      }
    } else {
      console.warn('[GoogleCastTransport] pause — cast.framework.RemotePlayer not available');
    }
    this.lastQueue = cloneQueueState(state);
  }

  async toggleSubtitles(state: CastQueueState): Promise<boolean> {
    const chromeCastWindow = getChromeCastWindow();
    if (!chromeCastWindow) {
      throw new Error('Google Cast sender SDK requires a browser window.');
    }

    await loadScriptOnce(this.scriptUrl);
    const isInitialized = await initializeGoogleCastLauncher();
    if (!isInitialized) {
      throw new Error('Google Cast framework did not initialize.');
    }

    const castContext = getCastContext(chromeCastWindow);
    const session = castContext?.getCurrentSession() ?? null;
    if (!session) {
      throw new Error('Connect to a Cast receiver before toggling subtitles.');
    }

    const itemToLoad = state.items.find((item) => item.id === state.activeItemId) ?? state.items[0] ?? null;
    if (!itemToLoad) {
      throw new Error('No active queue item is available for subtitle toggling.');
    }

    const mediaSession = session.getMediaSession?.() ?? null;

    const textTracks = (mediaSession?.media?.tracks ?? []).filter((track) => {
      const type = String(track?.type ?? '').toUpperCase();
      return type === 'TEXT';
    });

    const textTrackIds = textTracks
      .map((track) => track.trackId)
      .filter((trackId): trackId is number => typeof trackId === 'number');
    const currentActiveIds = mediaSession?.activeTrackIds ?? [];
    const hasActiveTextTrack = currentActiveIds.some((trackId) => textTrackIds.includes(trackId));

    if (!mediaSession?.editTracksInfo || textTrackIds.length === 0) {
      throw new Error('No editable subtitle tracks are available for this stream.');
    }

    const shouldEnableViaTracks = !hasActiveTextTrack;
    const nextActiveIds = shouldEnableViaTracks ? [textTrackIds[0]] : [];

    const mediaNamespace = chromeCastWindow.chrome?.cast?.media;
    const request = typeof mediaNamespace?.EditTracksInfoRequest === 'function'
      ? new mediaNamespace.EditTracksInfoRequest(nextActiveIds)
      : { activeTrackIds: nextActiveIds };

    await new Promise<void>((resolve, reject) => {
      try {
        const maybePromise = mediaSession.editTracksInfo?.(
          request,
          () => resolve(),
          (error: unknown) => reject(error instanceof Error ? error : new Error(String(error)))
        );

        if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
          (maybePromise as Promise<void>).then(resolve).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });

    const nextState: CastQueueState = {
      ...cloneQueueState(state),
      items: state.items.map((item) => {
        if (item.id !== itemToLoad.id) {
          return item;
        }

        return {
          ...item,
          customData: {
            ...(item.customData ?? {}),
            preferredAccessService: shouldEnableViaTracks ? 'SpokenSubtitles' : 'StandardVideo',
          },
        };
      }),
    };

    this.lastQueue = cloneQueueState(nextState);
    return shouldEnableViaTracks;
  }

  async stop(state: CastQueueState): Promise<void> {
    const chromeCastWindow = getChromeCastWindow();
    const fw = chromeCastWindow?.cast?.framework;
    console.log('[GoogleCastTransport] stop — RemotePlayer:', typeof fw?.RemotePlayer, 'RemotePlayerController:', typeof fw?.RemotePlayerController);
    if (fw?.RemotePlayer && fw?.RemotePlayerController) {
      try {
        const controller = new fw.RemotePlayerController(new fw.RemotePlayer());
        controller.stop();
        console.log('[GoogleCastTransport] stop() dispatched');
      } catch (e) {
        console.warn('[GoogleCastTransport] stop via RemotePlayerController failed:', e);
      }
    } else {
      console.warn('[GoogleCastTransport] stop — cast.framework.RemotePlayer not available');
    }
    this.lastQueue = cloneQueueState(state);
  }

  async disconnect(): Promise<void> {
    const chromeCastWindow = getChromeCastWindow();
    const fw = chromeCastWindow?.cast?.framework;
    if (fw?.CastContext) {
      try {
        const ctx = fw.CastContext.getInstance() as { endCurrentSession?: (stop: boolean) => void };
        ctx.endCurrentSession?.(true);
        console.log('[GoogleCastTransport] Cast session ended');
      } catch (e) {
        console.warn('[GoogleCastTransport] disconnect failed:', e);
      }
    }
    this.lastQueue = null;
    this.hasSessionMessageListener = false;
  }

  setReceiverMessageListener(listener: ((payload: CastCustomNamespaceMessage) => void) | null): void {
    this.receiverMessageListener = listener;
  }

  private ensureCustomNamespaceListener(session: GoogleCastSession): void {
    if (this.hasSessionMessageListener || !session.addMessageListener) {
      return;
    }

    session.addMessageListener(DR_TV_CUSTOM_NAMESPACE, (_namespace: string, message: unknown) => {
      let parsedMessage = message;
      if (typeof parsedMessage === 'string') {
        try {
          parsedMessage = JSON.parse(parsedMessage);
        } catch {
          return;
        }
      }

      if (!parsedMessage || typeof parsedMessage !== 'object') {
        return;
      }

      const payload = parsedMessage as Partial<CastCustomNamespaceMessage>;
      if (payload.type === 'timeCodeAvailability' && typeof payload.visible === 'boolean') {
        this.receiverMessageListener?.({
          type: 'timeCodeAvailability',
          visible: payload.visible,
          timeCodeType: typeof payload.timeCodeType === 'string' ? payload.timeCodeType : 'Intro',
          startTime: typeof payload.startTime === 'number' ? payload.startTime : 0,
          endTime: typeof payload.endTime === 'number' ? payload.endTime : 0,
          duration: typeof payload.duration === 'number' ? payload.duration : 0,
        });
      }
    });

    this.hasSessionMessageListener = true;
  }

  setUiOverrides(overrides: Partial<CastUiOverrides>): void {
    this.uiOverrides = mergeUiOverrides(this.uiOverrides ?? defaultCastUiOverrides, overrides);
  }

  getSnapshot(): { queue: CastQueueState | null; uiOverrides: CastUiOverrides | null } {
    return {
      queue: this.lastQueue ? cloneQueueState(this.lastQueue) : null,
      uiOverrides: this.uiOverrides,
    };
  }
}
