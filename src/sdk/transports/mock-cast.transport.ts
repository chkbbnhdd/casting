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

export class MockCastTransport implements CastTransport {
  readonly name = 'Mock cast transport';
  readonly isSupported = true;

  private lastQueue: CastQueueState | null = null;
  private uiOverrides: CastUiOverrides | null = null;
  private subtitlesEnabled = false;

  async connect(state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
  }

  async loadQueue(state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
  }

  async play(item: CastMediaItem, state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
    this.lastQueue.activeItemId = item.id;
  }

  async sendSessionUpdate(_payload: CastSessionUpdateMessage): Promise<void> {
    return;
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
  }

  async stop(state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
  }

  async disconnect(): Promise<void> {
    this.lastQueue = null;
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
