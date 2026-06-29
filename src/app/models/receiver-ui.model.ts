export type ReceiverUiState = 'awaiting-cast' | 'connected-idle' | 'playing' | 'error';

export interface ReceiverDebugState {
  path: string | null;
  pageUrl: string | null;
  pageStatus: number | null;
  itemId: string | null;
  videoUrl: string | null;
  videoStatus: number | null;
  streamUrl: string | null;
  contentType: string | null;
  sessionAccessToken: string | null;
  sessionIdToken: string | null;
  sessionSegments: string[];
  sessionAnonymousId: string | null;
  sessionUpdatedAt: string | null;
  playerState: string | null;
  lastEvent: string | null;
  lastError: string | null;
  skipTimeCode: string | null;
}
