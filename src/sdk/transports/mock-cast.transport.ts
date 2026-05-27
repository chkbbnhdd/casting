import { CastMediaItem, CastQueueState, CastTransport, CastUiOverrides, defaultCastUiOverrides } from '../common/types';
import { cloneQueueState, mergeUiOverrides } from '../common/utils';

export class MockCastTransport implements CastTransport {
  readonly name = 'Mock cast transport';
  readonly isSupported = true;

  private lastQueue: CastQueueState | null = null;
  private uiOverrides: CastUiOverrides | null = null;

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

  async pause(state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
  }

  async stop(state: CastQueueState): Promise<void> {
    this.lastQueue = cloneQueueState(state);
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
