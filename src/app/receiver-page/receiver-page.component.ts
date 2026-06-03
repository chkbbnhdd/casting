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
  protected readonly isPlaying = signal(false);
  protected readonly nextItemTitle = signal<string | null>(null);
  protected readonly nextItemThumbnail = signal<string | null>(null);
  protected readonly logs = signal<string[]>([]);

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
      const EventType = window.cast.framework.events.EventType;

      playerManager.addEventListener(EventType.PLAYER_STATE_CHANGED, (event: any) => {
        this.isPlaying.set(event?.playerState === 'PLAYING');
      });

      playerManager.setMessageInterceptor(MessageType.LOAD, (loadRequestData: any) => {
        this.pushLog('Received LOAD message');
        this.pushLog('Media URL: ' + loadRequestData?.media?.contentId);
        this.pushLog('Media MIME: ' + loadRequestData?.media?.contentType);
        this.isPlaying.set(false);

        try {
          const payload = loadRequestData?.customData?.queue ?? loadRequestData?.media?.customData?.queue ?? null;
          if (payload && payload.queue) {
            const selectedId = payload.selectedItemId ?? payload.queue?.activeItemId ?? payload.queue.items?.[0]?.id ?? null;
            const selectedItem = (payload.queue.items || []).find((i: any) => i.id === selectedId) || payload.queue.items?.[0];
            if (selectedItem) {
              this.title.set(selectedItem.title || 'Untitled');
              this.subtitle.set(selectedItem.subtitle || selectedItem.url || '');
              this.pushLog('Showing queue item: ' + (selectedItem.title || selectedItem.id));
              
              // Find and display next item
              const selectedIndex = (payload.queue.items || []).findIndex((i: any) => i.id === selectedItem.id);
              const nextItem = selectedIndex >= 0 && selectedIndex < (payload.queue.items || []).length - 1 
                ? payload.queue.items[selectedIndex + 1]
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
            this.nextItemTitle.set(null);
            this.nextItemThumbnail.set(null);
            this.pushLog('Showing media.customData.selectedItemTitle: ' + t);
          } else if (loadRequestData?.media) {
            this.title.set(loadRequestData.media?.metadata?.title || 'Playing media');
            this.subtitle.set(loadRequestData.media?.metadata?.subtitle || loadRequestData.media?.contentId || '');
            this.nextItemTitle.set(null);
            this.nextItemThumbnail.set(null);
            this.pushLog('Showing media.metadata title');
          }
        } catch (e: any) {
          this.pushLog('Error processing LOAD message: ' + (e?.message ?? String(e)));
        }

        return loadRequestData;
      });

      context.start();
      this.pushLog('Receiver context started');
    } catch (e: any) {
      this.pushLog('Receiver initialize error: ' + (e?.message ?? String(e)));
    }
  }
}