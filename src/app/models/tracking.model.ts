export interface TrackingFeatureFlags {
  disableNPAW?: boolean;
  npawEnabled?: boolean;
}

export interface TrackingPlaybackContext {
  itemId?: string | null;
  title?: string;
  subtitle?: string;
  streamUrl?: string;
  mimeType?: string;
  durationSeconds?: number;
  isLive?: boolean;
  profileId?: string;
  consents?: string[];
  liveAbsoluteTimeSeconds?: number;
  senderDevice?: string;
  autoPlayReason?: string;
}

export type TrackingPlayerState =
  | 'PLAYING'
  | 'PAUSED'
  | 'BUFFERING'
  | 'LOADING'
  | 'IDLE'
  | 'COMPLETED'
  | 'UNKNOWN';

export interface TrackingSessionContext {
  anonymousId: string;
  accessToken?: string;
  idToken?: string;
  profileId?: string;
  consents?: string[];
  segments?: string[];
}
