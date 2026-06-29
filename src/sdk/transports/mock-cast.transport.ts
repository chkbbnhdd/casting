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
import { cloneQueueState, mergeUiOverrides } from '../common/utils';
import { devBridge } from '../common/dev-bridge';

export class MockCastTransport implements CastTransport {
  readonly name = 'Mock cast transport (dev)';
  readonly isSupported = true;

  private lastQueue: CastQueueState | null = null;
  private uiOverrides: CastUiOverrides | null = null;
  private subtitlesEnabled = false;

  async connect(state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
    // Notify receiver about connection
    devBridge.sendMessage('connect', { connected: true });
  }

  async loadQueue(state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
    // Send queue to receiver via dev bridge for local testing
    devBridge.sendMessage('loadQueue', { queue: this.lastQueue });
    console.log('[MockCastTransport] Sent loadQueue via dev bridge:', this.lastQueue);
  }

  async play(item: CastMediaItem, state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
    this.lastQueue.activeItemId = item.id;
    // Send play command to receiver
    devBridge.sendMessage('play', { 
      itemId: item.id,
      queue: this.lastQueue 
    });
  }

  async sendSessionUpdate(payload: CastSessionUpdateMessage): Promise<void> {
    // Send session update to receiver
    devBridge.sendMessage('sessionUpdate', payload);
    console.log('[MockCastTransport] Sent sessionUpdate via dev bridge');
  }

  async sendSkipTimeCode(_payload: CastSkipTimeCodeMessage): Promise<void> {
    return;
  }

  setReceiverMessageListener(_listener: ((payload: CastCustomNamespaceMessage) => void) | null): void {
    return;
  }

  async toggleSubtitles(_state: CastQueueState): Promise<boolean> {
    this.subtitlesEnabled = !this.subtitlesEnabled;
    return this.subtitlesEnabled;
  }

  async pause(state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
    // Send pause command to receiver
    devBridge.sendMessage('pause', { queue: this.lastQueue });
  }

  async stop(state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
    // Send stop command to receiver
    devBridge.sendMessage('stop', { queue: this.lastQueue });
  }

  async disconnect(): Promise<void> {
    this.lastQueue = null;
    // Notify receiver about disconnection
    devBridge.sendMessage('disconnect', { connected: false });
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
