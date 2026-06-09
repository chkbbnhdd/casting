import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, OnInit, signal } from '@angular/core';

declare global {
  interface Window {
    cast?: any;
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
  }
}

const CAST_RECEIVER_SCRIPT_URL = 'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js';
const NEXT_UP_PREVIEW_SECONDS = 30;
const CONTROLS_HIDE_DELAY_MS = 5000;
const CONFIG_ENDPOINT_URL = 'https://prod95-cdn.dr-massive.com/api/config?device=chromecast&ff=idp%2Cldp%2Crpt&include=classification%2Csubscription%2Csitemap%2Cnavigation%2Cgeneral%2Ci18n%2Cplayback%2Clinear%2CfeatureFlags&lang=da&segments=drtv&sub=Registered';
const PAGE_ENDPOINT_BASE_URL = 'https://prod95-cdn.dr-massive.com/api/page';
const VIDEO_ENDPOINT_BASE_URL = 'https://prod95.dr-massive.com/api/account/items';

type ReceiverUiState = 'awaiting-cast' | 'connected-idle' | 'playing';

interface ResolvedPlayback {
  streamUrl: string;
  mimeType: string;
  title?: string;
  subtitle?: string;
  posterUrl?: string;
}

function loadReceiverFramework(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Cast receiver framework requires a browser environment.'));
  }

  if (window.cast?.framework?.CastReceiverContext) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const previousCallback = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      previousCallback?.(isAvailable);
      if (isAvailable && window.cast?.framework?.CastReceiverContext) {
        resolve();
      } else if (!isAvailable) {
        reject(new Error('Cast receiver framework is unavailable.'));
      }
    };

    const existing = document.querySelector<HTMLScriptElement>('script[src*="cast_receiver_framework.js"]');
    if (existing) {
      if (window.cast?.framework?.CastReceiverContext) {
        resolve();
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Cast receiver framework')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = CAST_RECEIVER_SCRIPT_URL;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load Cast receiver framework')), { once: true });
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
  protected readonly title = signal('Waiting for content');
  protected readonly subtitle = signal('Idle');
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

  private storedQueueItems: any[] = [];
  private storedActiveItemId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.pushLog('Receiver booting');
    try {
      await this.loadConfigResponse();
      await loadReceiverFramework();
      this.pushLog('CAF framework loaded');
      this.initializeReceiver();
    } catch (err: any) {
      this.pushLog('Receiver initialization failed: ' + (err?.message ?? String(err)));
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
      device: 'web_browser',
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

  private inferMimeType(streamUrl: string): string {
    return streamUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4';
  }

  private async resolvePlaybackFromQueueItem(item: any): Promise<ResolvedPlayback> {
    const rawPath = item?.customData?.path ?? item?.url;
    const accessToken = item?.customData?.accessToken;
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      throw new Error('Queue item path is missing.');
    }

    const normalizedPath = rawPath.trim().startsWith('/') ? rawPath.trim() : `/${rawPath.trim()}`;
    const pageUrl = this.buildPageUrl(normalizedPath);
    this.pushLog(`Resolving page for path ${normalizedPath}`);

    const pageResponse = await fetch(pageUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

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

    if (typeof accessToken !== 'string' || !accessToken.trim()) {
      throw new Error('Missing accessToken for protected video endpoint.');
    }

    const videoUrl = this.buildVideoUrl(itemId);
    this.pushLog(`Fetching media stream for item ${itemId}`);
    const videoResponse = await fetch(videoUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken.trim()}`,
      },
    });

    if (!videoResponse.ok) {
      throw new Error(`Video request failed with ${videoResponse.status}`);
    }

    const mediaFiles = await videoResponse.json();
    const primary = Array.isArray(mediaFiles) ? mediaFiles.find((file: any) => typeof file?.url === 'string') : null;
    const streamUrl = primary?.url;
    if (typeof streamUrl !== 'string' || !streamUrl) {
      throw new Error('No playable stream URL found in video response.');
    }

    return {
      streamUrl,
      mimeType: this.inferMimeType(streamUrl),
      title: firstEntry?.title ?? pageJson?.title ?? item?.title,
      subtitle: pageItem?.episodeName ?? pageItem?.showName ?? item?.subtitle,
      posterUrl: pageItem?.images?.tile ?? pageItem?.images?.wallpaper ?? pageItem?.images?.poster ?? item?.posterUrl,
    };
  }

  private initializeReceiver(): void {
    try {
      const context = window.cast.framework.CastReceiverContext.getInstance();
      const playerManager = context.getPlayerManager();
      const MessageType = window.cast.framework.messages.MessageType;

      const systemEventType = window.cast?.framework?.system?.EventType;
      if (systemEventType?.SENDER_CONNECTED) {
        context.addEventListener(systemEventType.SENDER_CONNECTED, () => {
          this.hasSenderConnected.set(true);
          this.updateUiState();
          this.pushLog('Sender connected');
        });
      }
      if (systemEventType?.SENDER_DISCONNECTED) {
        context.addEventListener(systemEventType.SENDER_DISCONNECTED, () => {
          this.hasSenderConnected.set(false);
          this.updateUiState();
          this.pushLog('Sender disconnected');
        });
      }

      const controls = window.cast?.framework?.ui?.Controls?.getInstance?.();
      if (controls?.clearDefaultSlotAssignments) {
        controls.clearDefaultSlotAssignments();
        this.pushLog('Disabled default cast-media-player overlay controls');
      }

      playerManager.setMessageInterceptor(MessageType.LOAD, async (loadRequestData: any) => {
        this.hasSenderConnected.set(true);
        this.updateUiState();
        this.pushLog('Received LOAD message');
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
        this.showNextUp.set(false);

        try {
          const payload = loadRequestData?.customData?.queue ?? loadRequestData?.media?.customData?.queue ?? null;
          if (payload && payload.items) {
            this.queueStatus.set(payload.status ?? 'idle');
            const selectedId = loadRequestData?.customData?.selectedItemId ?? loadRequestData?.media?.customData?.selectedItemId ?? payload.activeItemId ?? payload.items?.[0]?.id ?? null;
            const selectedItem = (payload.items || []).find((i: any) => i.id === selectedId) || payload.items?.[0];
            this.storedQueueItems = payload.items || [];
            if (selectedItem) {
              let resolvedPlayback: ResolvedPlayback | null = null;
              try {
                resolvedPlayback = await this.resolvePlaybackFromQueueItem(selectedItem);
              } catch (resolveError: any) {
                this.pushLog('Playback resolution failed, falling back to raw queue URL: ' + (resolveError?.message ?? String(resolveError)));
              }

              this.storedActiveItemId = selectedItem.id;
              this.title.set(resolvedPlayback?.title || selectedItem.title || 'Untitled');
              this.subtitle.set(resolvedPlayback?.subtitle || selectedItem.subtitle || selectedItem.url || '');
              this.pushLog('Showing queue item: ' + (selectedItem.title || selectedItem.id));

              if (resolvedPlayback?.posterUrl) {
                selectedItem.posterUrl = resolvedPlayback.posterUrl;
              }

              // Ensure contentUrl is set for the player — sender SDK may not serialize it
              if (loadRequestData.media) {
                const playbackUrl = resolvedPlayback?.streamUrl ?? selectedItem.url;
                if (playbackUrl) {
                  loadRequestData.media.contentUrl = playbackUrl;
                  loadRequestData.media.contentId = playbackUrl;
                  loadRequestData.media.contentType = resolvedPlayback?.mimeType ?? selectedItem.mimeType ?? 'video/mp4';
                  this.pushLog('Set contentUrl from resolved playback: ' + playbackUrl);
                }
              }

              // Find and display next item
              const selectedIndex = (payload.items || []).findIndex((i: any) => i.id === selectedItem.id);
              const nextItem = selectedIndex >= 0 && selectedIndex < (payload.items || []).length - 1
                ? payload.items[selectedIndex + 1]
                : null;

              if (nextItem) {
                this.nextItemTitle.set(nextItem.title || 'Untitled');
                this.nextItemThumbnail.set(nextItem.posterUrl || null);
                this.pushLog('Next item queued: ' + (nextItem.title || nextItem.id));
              } else {
                this.nextItemTitle.set(null);
                this.nextItemThumbnail.set(null);
              }
            }
          } else if (loadRequestData?.media?.customData?.selectedItemTitle) {
            const t = loadRequestData.media.customData.selectedItemTitle;
            this.title.set(t || 'Untitled');
            this.subtitle.set(loadRequestData.media?.contentId || '');
            this.queueStatus.set('playing');
            this.nextItemTitle.set(null);
            this.nextItemThumbnail.set(null);
            this.pushLog('Showing media.customData.selectedItemTitle: ' + t);
          } else if (loadRequestData?.media) {
            this.title.set(loadRequestData.media?.metadata?.title || 'Playing media');
            this.subtitle.set(loadRequestData.media?.metadata?.subtitle || loadRequestData.media?.contentId || '');
            this.queueStatus.set('playing');
            this.nextItemTitle.set(null);
            this.nextItemThumbnail.set(null);
            this.pushLog('Showing media.metadata title');
          }
        } catch (e: any) {
          this.pushLog('Error processing LOAD message: ' + (e?.message ?? String(e)));
        }

        return loadRequestData;
      });

      const EventType = window.cast.framework.events.EventType;
      playerManager.addEventListener(EventType.ENDED, () => {
        this.onCurrentItemEnded(playerManager);
      });
      playerManager.addEventListener(EventType.ERROR, (event: any) => {
        const code = event?.detailedErrorCode ?? event?.errorCode ?? 'unknown';
        const reason = event?.reason ?? '';
        this.pushLog(`PLAYBACK ERROR: code=${code}${reason ? ' reason=' + reason : ''}`);
      });
      playerManager.addEventListener(EventType.MEDIA_STATUS, (event: any) => {
        const playerState = event?.mediaStatus?.playerState ?? 'unknown';
        this.pushLog('Player state: ' + playerState);
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
        if (duration > 0 && this.nextItemTitle()) {
          const remaining = duration - current;
          this.showNextUp.set(remaining <= NEXT_UP_PREVIEW_SECONDS);
        }
      });

      context.start();
      this.pushLog('Receiver context started');
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
      this.updateUiState();
      this.pushLog('Queue finished');
      return;
    }

    let resolvedPlayback: ResolvedPlayback | null = null;
    try {
      resolvedPlayback = await this.resolvePlaybackFromQueueItem(nextItem);
    } catch (resolveError: any) {
      this.pushLog('Auto-advance playback resolution failed, using raw queue URL: ' + (resolveError?.message ?? String(resolveError)));
    }

    this.storedActiveItemId = nextItem.id;
    this.title.set(resolvedPlayback?.title || nextItem.title || 'Untitled');
    this.subtitle.set(resolvedPlayback?.subtitle || nextItem.subtitle || nextItem.url || '');
    this.queueStatus.set('playing');
    this.showNextUp.set(false);

    const nextNextItem = currentIndex + 2 < items.length ? items[currentIndex + 2] : null;
    this.nextItemTitle.set(nextNextItem?.title ?? null);
    this.nextItemThumbnail.set(nextNextItem?.posterUrl ?? null);

    try {
      const loadReq = new window.cast.framework.messages.LoadRequestData();
      loadReq.media = new window.cast.framework.messages.MediaInformation();
      const playbackUrl = resolvedPlayback?.streamUrl ?? nextItem.url;
      loadReq.media.contentId = playbackUrl;
      loadReq.media.contentUrl = playbackUrl;
      loadReq.media.contentType = resolvedPlayback?.mimeType ?? nextItem.mimeType ?? 'video/mp4';
      const isHls = (nextItem.mimeType || '').includes('mpegURL') || (nextItem.mimeType || '').includes('mpegurl');
      loadReq.media.streamType = isHls ? 'BUFFERED' : 'BUFFERED';
      loadReq.autoplay = true;
      playerManager.load(loadReq);
      this.pushLog('Auto-advancing to: ' + (nextItem.title || nextItem.id));
    } catch (e: any) {
      this.pushLog('Error auto-advancing queue: ' + (e?.message ?? String(e)));
    }
  }
}