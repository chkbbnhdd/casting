import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, OnInit, signal } from '@angular/core';

declare global {
  interface Window {
    cast?: any;
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
  }
}

const CAST_RECEIVER_SCRIPT_URL = 'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js';

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
  protected readonly queueStatus = signal<string>('idle');
  protected readonly nextItemTitle = signal<string | null>(null);
  protected readonly nextItemThumbnail = signal<string | null>(null);
  protected readonly logs = signal<string[]>([]);

  private storedQueueItems: any[] = [];
  private storedActiveItemId: string | null = null;

  async ngOnInit(): Promise<void> {
    this.pushLog('Receiver booting');
    try {
      await loadReceiverFramework();
      this.pushLog('CAF framework loaded');
      this.initializeReceiver();
    } catch (err: any) {
      this.pushLog('Receiver initialization failed: ' + (err?.message ?? String(err)));
    }
  }

  ngOnDestroy(): void {
    // nothing special to teardown
  }

  private pushLog(message: string): void {
    const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
    this.logs.update((current) => [entry, ...current].slice(0, 200));
    console.log(message);
  }

  private initializeReceiver(): void {
    try {
      const context = window.cast.framework.CastReceiverContext.getInstance();
      const playerManager = context.getPlayerManager();
      const MessageType = window.cast.framework.messages.MessageType;

      playerManager.setMessageInterceptor(MessageType.LOAD, (loadRequestData: any) => {
        this.pushLog('Received LOAD message');
        this.pushLog('contentId: ' + loadRequestData?.media?.contentId);
        this.pushLog('contentUrl: ' + (loadRequestData?.media?.contentUrl ?? '(not set)'));
        this.pushLog('contentType: ' + loadRequestData?.media?.contentType);
        this.pushLog('streamType: ' + loadRequestData?.media?.streamType);
        this.nextItemTitle.set(null);
        this.nextItemThumbnail.set(null);

        try {
          const payload = loadRequestData?.customData?.queue ?? loadRequestData?.media?.customData?.queue ?? null;
          if (payload && payload.items) {
            this.queueStatus.set(payload.status ?? 'idle');
            const selectedId = loadRequestData?.customData?.selectedItemId ?? loadRequestData?.media?.customData?.selectedItemId ?? payload.activeItemId ?? payload.items?.[0]?.id ?? null;
            const selectedItem = (payload.items || []).find((i: any) => i.id === selectedId) || payload.items?.[0];
            this.storedQueueItems = payload.items || [];
            if (selectedItem) {
              this.storedActiveItemId = selectedItem.id;
              this.title.set(selectedItem.title || 'Untitled');
              this.subtitle.set(selectedItem.subtitle || selectedItem.url || '');
              this.pushLog('Showing queue item: ' + (selectedItem.title || selectedItem.id));

              // Ensure contentUrl is set for the player — sender SDK may not serialize it
              if (loadRequestData.media && !loadRequestData.media.contentUrl && selectedItem.url) {
                loadRequestData.media.contentUrl = selectedItem.url;
                this.pushLog('Set contentUrl from queue: ' + selectedItem.url);
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
      });

      context.start();
      this.pushLog('Receiver context started');
    } catch (e: any) {
      this.pushLog('Receiver initialize error: ' + (e?.message ?? String(e)));
    }
  }

  private onCurrentItemEnded(playerManager: any): void {
    const items = this.storedQueueItems;
    const currentIndex = items.findIndex((i: any) => i.id === this.storedActiveItemId);
    const nextItem = currentIndex >= 0 && currentIndex < items.length - 1
      ? items[currentIndex + 1]
      : null;

    if (!nextItem) {
      this.queueStatus.set('idle');
      this.nextItemTitle.set(null);
      this.nextItemThumbnail.set(null);
      this.pushLog('Queue finished');
      return;
    }

    this.storedActiveItemId = nextItem.id;
    this.title.set(nextItem.title || 'Untitled');
    this.subtitle.set(nextItem.subtitle || nextItem.url || '');
    this.queueStatus.set('playing');

    const nextNextItem = currentIndex + 2 < items.length ? items[currentIndex + 2] : null;
    this.nextItemTitle.set(nextNextItem?.title ?? null);
    this.nextItemThumbnail.set(nextNextItem?.posterUrl ?? null);

    try {
      const loadReq = new window.cast.framework.messages.LoadRequestData();
      loadReq.media = new window.cast.framework.messages.MediaInformation();
      loadReq.media.contentId = nextItem.url;
      loadReq.media.contentUrl = nextItem.url;
      loadReq.media.contentType = nextItem.mimeType || 'video/mp4';
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