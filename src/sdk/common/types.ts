export type CastPlaybackStatus = 'idle' | 'ready' | 'playing' | 'paused' | 'buffering' | 'error';

export interface CastMediaItem {
  id: string;
  title: string;
  url: string;
  mimeType: string;
  posterUrl?: string;
  subtitle?: string;
  description?: string;
  durationSeconds?: number;
  customData?: Record<string, unknown>;
}

export interface CastQueueState {
  items: CastMediaItem[];
  activeItemId: string | null;
  status: CastPlaybackStatus;
  lastUpdatedIso: string;
}

export interface CastReceiverQueuePayload {
  queue: CastQueueState;
  sentAtIso: string;
}

export interface CastUiOverrides {
  routeButtonLabel: string;
  queueTitle: string;
  emptyQueueTitle: string;
  emptyQueueSubtitle: string;
  nowPlayingTitle: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  accentColor: string;
}

export const defaultCastUiOverrides: CastUiOverrides = {
  routeButtonLabel: 'Cast to screen',
  queueTitle: 'Playback queue',
  emptyQueueTitle: 'No queued videos yet',
  emptyQueueSubtitle: 'Add several videos, then push the queue to the receiver.',
  nowPlayingTitle: 'Now playing',
  primaryActionLabel: 'Send queue',
  secondaryActionLabel: 'Clear queue',
  accentColor: '#ff8a3d',
};

export interface CastSenderState {
  queue: CastQueueState;
  connected: boolean;
  sdkReady: boolean;
  transportName: string;
  statusMessage: string;
  lastError: string | null;
  subtitlesEnabled: boolean | null;
  uiOverrides: CastUiOverrides;
}

export interface CastTransport {
  readonly name: string;
  readonly isSupported: boolean;
  connect?(state: CastQueueState): Promise<void> | void;
  loadQueue?(state: CastQueueState): Promise<void> | void;
  play?(item: CastMediaItem, state: CastQueueState): Promise<void> | void;
  toggleSubtitles?(state: CastQueueState): Promise<boolean> | boolean;
  pause?(state: CastQueueState): Promise<void> | void;
  stop?(state: CastQueueState): Promise<void> | void;
  disconnect?(): Promise<void> | void;
  setUiOverrides?(overrides: Partial<CastUiOverrides>): void;
}

export interface CastQueueStrategy {
  readonly strategyName: string;
  seed(items: CastMediaItem[], activeItemId?: string | null): CastQueueState;
  append(state: CastQueueState, items: CastMediaItem[]): CastQueueState;
  replace(state: CastQueueState, items: CastMediaItem[], activeItemId?: string | null): CastQueueState;
  select(state: CastQueueState, itemId: string): CastQueueState;
  remove(state: CastQueueState, itemId: string): CastQueueState;
  move(state: CastQueueState, fromIndex: number, toIndex: number): CastQueueState;
  advance(state: CastQueueState): CastQueueState;
  rewind(state: CastQueueState): CastQueueState;
}
