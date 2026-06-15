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

export interface CastSessionUpdateAuth {
  accessToken: string;
  idToken: string;
}

export interface CastSessionUpdateTracking {
  anonymousId: string;
}

export interface CastSessionUpdateMessage {
  type: 'sessionUpdate';
  auth: CastSessionUpdateAuth;
  segments: string[];
  tracking: CastSessionUpdateTracking;
}

export interface CastTimeCodeAvailabilityMessage {
  type: 'timeCodeAvailability';
  visible: boolean;
  timeCodeType: string;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface CastSkipTimeCodeMessage {
  type: 'skipTimeCode';
  timeCodeType: string;
}

export type CastCustomNamespaceMessage =
  | CastSessionUpdateMessage
  | CastTimeCodeAvailabilityMessage
  | CastSkipTimeCodeMessage;

export interface CastSkipControlState {
  visible: boolean;
  label: string;
  timeCodeType: string | null;
  startTime: number | null;
  endTime: number | null;
  duration: number | null;
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
  skipControl: CastSkipControlState;
  uiOverrides: CastUiOverrides;
}

export interface CastTransport {
  readonly name: string;
  readonly isSupported: boolean;
  connect?(state: CastQueueState): Promise<void> | void;
  loadQueue?(state: CastQueueState): Promise<void> | void;
  play?(item: CastMediaItem, state: CastQueueState): Promise<void> | void;
  sendSessionUpdate?(payload: CastSessionUpdateMessage): Promise<void> | void;
  sendSkipTimeCode?(payload: CastSkipTimeCodeMessage): Promise<void> | void;
  setReceiverMessageListener?(listener: ((payload: CastCustomNamespaceMessage) => void) | null): void;
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
