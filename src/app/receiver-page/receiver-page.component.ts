import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CastMediaItem, CastReceiverQueuePayload } from '../../sdk';

declare global {
  interface Window {
    cast?: any;
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
  }
}

const CAST_RECEIVER_SCRIPT_URL = 'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js';
let receiverScriptPromise: Promise<void> | null = null;
let receiverStarted = false;

type ReceiverScreenState = {
  items: CastMediaItem[];
  activeItemId: string | null;
  status: string;
};

type ReceiverDiagnostics = {
  hasCast: boolean;
  hasFramework: boolean;
  hasReceiverContext: boolean;
  hasPlayerManager: boolean;
  hasPlayerStateEventType: boolean;
  hasMediaInformationChangedEventType: boolean;
  hasLoadMessageType: boolean;
  hasCastSdkScriptTag: boolean;
  hasApiAvailableCallback: boolean;
};

function loadReceiverFramework(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Cast receiver framework requires a browser environment.'));
  }

  if (window.cast?.framework?.CastReceiverContext) {
    return Promise.resolve();
  }

  if (receiverScriptPromise) {
    return receiverScriptPromise;
  }

  receiverScriptPromise = new Promise<void>((resolve, reject) => {
    if (window.cast?.framework?.CastReceiverContext) {
      resolve();
      return;
    }

    const previousCallback = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      previousCallback?.(isAvailable);
      if (isAvailable && window.cast?.framework?.CastReceiverContext) {
        resolve();
      } else if (!isAvailable) {
        reject(new Error('Cast receiver framework is unavailable.'));
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-cast-receiver-sdk="true"]');
    if (existingScript) {
      if (window.cast?.framework?.CastReceiverContext) {
        resolve();
        return;
      }

      existingScript.addEventListener('load', () => {
        if (window.cast?.framework?.CastReceiverContext) {
          resolve();
        }
      }, { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load the Cast receiver framework.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = CAST_RECEIVER_SCRIPT_URL;
    script.dataset['castReceiverSdk'] = 'true';
    script.addEventListener('load', () => {
      if (window.cast?.framework?.CastReceiverContext) {
        resolve();
      }
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load the Cast receiver framework.')), { once: true });
    document.head.appendChild(script);
  });

  return receiverScriptPromise;
}

@Component({
  selector: 'app-receiver-page',
  imports: [CommonModule],
  templateUrl: './receiver-page.component.html',
  styleUrl: './receiver-page.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ReceiverPageComponent implements OnInit, OnDestroy {
  protected readonly state = signal<ReceiverScreenState>({
    items: [],
    activeItemId: null,
    status: 'Idle',
  });
  protected readonly diagnostics = signal<ReceiverDiagnostics>({
    hasCast: false,
    hasFramework: false,
    hasReceiverContext: false,
    hasPlayerManager: false,
    hasPlayerStateEventType: false,
    hasMediaInformationChangedEventType: false,
    hasLoadMessageType: false,
    hasCastSdkScriptTag: false,
    hasApiAvailableCallback: false,
  });
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly queueCountLabel = computed(() => {
    const count = this.state().items.length;
    return `${count} ${count === 1 ? 'item' : 'items'}`;
  });
  protected readonly activeIndexLabel = computed(() => {
    const currentState = this.state();
    const activeIndex = currentState.items.findIndex((item) => item.id === currentState.activeItemId);
    return activeIndex >= 0 ? `${activeIndex + 1} / ${currentState.items.length}` : `0 / ${currentState.items.length}`;
  });
  protected readonly activeItem = computed(() => {
    const currentState = this.state();
    return currentState.items.find((item) => item.id === currentState.activeItemId) ?? currentState.items[0] ?? null;
  });

  private readonly teardownCallbacks: Array<() => void> = [];

  async ngOnInit(): Promise<void> {
    this.refreshDiagnostics();

    try {
      await loadReceiverFramework();
      this.refreshDiagnostics();
      this.initializeReceiver();
    } catch (error) {
      this.refreshDiagnostics();
      this.errorMessage.set(error instanceof Error ? error.message : 'Receiver initialization failed.');
    }
  }

  ngOnDestroy(): void {
    for (const teardown of this.teardownCallbacks) {
      teardown();
    }

    this.teardownCallbacks.length = 0;
  }

  private initializeReceiver(): void {
    if (receiverStarted) {
      this.state.update((currentState) => ({
        ...currentState,
        status: currentState.status || 'Ready',
      }));
      return;
    }

    const context = window.cast?.framework?.CastReceiverContext?.getInstance?.();
    const playerManager = context?.getPlayerManager?.();
    const playerStateEventType = window.cast?.framework?.events?.EventType?.PLAYER_STATE;
    const mediaInformationChangedEventType = window.cast?.framework?.events?.EventType?.MEDIA_INFORMATION_CHANGED;
    const loadMessageType = window.cast?.framework?.messages?.MessageType?.LOAD;

    if (!context || !playerManager || !playerStateEventType || !mediaInformationChangedEventType || !loadMessageType) {
      throw new Error('Cast receiver framework is available, but the expected CAF APIs are missing.');
    }

    playerManager.setMessageInterceptor(loadMessageType, (loadRequestData: any) => {
      const payload = this.getQueuePayload(loadRequestData);
      if (payload?.queue) {
        const nextItems = Array.isArray(payload.queue.items) ? payload.queue.items : [];
        const nextActiveId = payload.selectedItemId || loadRequestData.media?.customData?.selectedItemId || payload.queue.activeItemId || null;
        this.state.set({
          items: nextItems,
          activeItemId: nextActiveId ?? nextItems[0]?.id ?? null,
          status: 'Loading',
        });
        this.errorMessage.set(null);
      }

      return loadRequestData;
    });

    const playerStateListener = (event: { newState?: string }) => {
      this.state.update((currentState) => ({
        ...currentState,
        status: event.newState || currentState.status,
      }));
    };

    const mediaInformationChangedListener = () => {
      const media = playerManager.getMediaInformation?.();
      const selectedItemId = media?.customData?.selectedItemId;
      if (!selectedItemId) {
        return;
      }

      this.state.update((currentState) => ({
        ...currentState,
        activeItemId: selectedItemId,
      }));
    };

    playerManager.addEventListener(playerStateEventType, playerStateListener);
    playerManager.addEventListener(mediaInformationChangedEventType, mediaInformationChangedListener);

    this.teardownCallbacks.push(() => playerManager.removeEventListener?.(playerStateEventType, playerStateListener));
    this.teardownCallbacks.push(() => playerManager.removeEventListener?.(mediaInformationChangedEventType, mediaInformationChangedListener));

    context.start({
      disableIdleTimeout: true,
      statusText: 'Ready to receive queue casts',
    });
    this.state.update((currentState) => ({
      ...currentState,
      status: 'Ready',
    }));
    this.refreshDiagnostics();
    receiverStarted = true;
  }

  private refreshDiagnostics(): void {
    this.diagnostics.set(this.getReceiverDiagnostics());
  }

  private getReceiverDiagnostics(): ReceiverDiagnostics {
    const hasCast = Boolean(window.cast);
    const hasFramework = Boolean(window.cast?.framework);
    const hasReceiverContext = Boolean(window.cast?.framework?.CastReceiverContext);
    const receiverContext = window.cast?.framework?.CastReceiverContext?.getInstance?.();
    const hasPlayerManager = Boolean(receiverContext?.getPlayerManager?.());
    const hasPlayerStateEventType = Boolean(window.cast?.framework?.events?.EventType?.PLAYER_STATE);
    const hasMediaInformationChangedEventType = Boolean(window.cast?.framework?.events?.EventType?.MEDIA_INFORMATION_CHANGED);
    const hasLoadMessageType = Boolean(window.cast?.framework?.messages?.MessageType?.LOAD);
    const hasCastSdkScriptTag = Boolean(document.querySelector<HTMLScriptElement>('script[data-cast-receiver-sdk="true"]'));
    const hasApiAvailableCallback = typeof window.__onGCastApiAvailable === 'function';

    return {
      hasCast,
      hasFramework,
      hasReceiverContext,
      hasPlayerManager,
      hasPlayerStateEventType,
      hasMediaInformationChangedEventType,
      hasLoadMessageType,
      hasCastSdkScriptTag,
      hasApiAvailableCallback,
    };
  }

  private getQueuePayload(loadRequestData: any): (CastReceiverQueuePayload & { selectedItemId?: string }) | null {
    if (loadRequestData?.customData?.queue) {
      return loadRequestData.customData;
    }

    if (loadRequestData?.media?.customData?.queue) {
      return loadRequestData.media.customData;
    }

    return null;
  }
}