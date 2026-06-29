import { AnalyticsBrowser } from '@segment/analytics-next';
import {
  TrackingPlaybackContext,
  TrackingPlayerState,
  TrackingSessionContext,
} from '../models/tracking.model';

enum StreamEvent {
  Started = 'Stream Started',
  Paused = 'Stream Paused',
  Seeked = 'Stream Seeked',
  Stopped = 'Stream Stopped',
  Completed = 'Stream Completed',
  Consumed = 'Stream Consumed',
}

export class AnalyticsManager {
  private analytics?: AnalyticsBrowser;
  private currentPlayback?: TrackingPlaybackContext;
  private profileId?: string;
  private consents?: string[];
  private didTrackStreamConsumed = false;
  private isSubsequent = false;
  private consumedTimeoutId: number | null = null;
  private lastPlayerState: TrackingPlayerState = 'UNKNOWN';
  private readonly writeKey: string;

  constructor(private readonly isPreprod: boolean) {
    this.writeKey = isPreprod
      ? 'lOCsJIqz2xJmgaMPwPOZQfZwVLwnQ7GO'
      : 'KIriBU1phhOSCe8VJHOthZ6HJGPJcIfk';
  }

  async updateSession(context: TrackingSessionContext): Promise<void> {
    await this.ensureAnalytics();
    if (!this.analytics) {
      return;
    }

    await this.analytics.reset();
    this.analytics.setAnonymousId(context.anonymousId);
    this.consents = context.consents;

    if (context.profileId && context.profileId.trim()) {
      this.profileId = context.profileId.trim();
    }

    const userId = this.decodeProfileId(context.idToken) ?? this.decodeProfileId(context.accessToken);
    if (!this.profileId && userId) {
      this.profileId = `user|${userId}`;
    }

    if (userId) {
      this.analytics.identify(userId);
    }
  }

  setPlayback(context: TrackingPlaybackContext): void {
    this.currentPlayback = context;
    if (context.profileId && context.profileId.trim()) {
      this.profileId = context.profileId.trim();
    }
    if (Array.isArray(context.consents)) {
      this.consents = context.consents;
    }
    this.didTrackStreamConsumed = false;
    this.isSubsequent = false;
    this.lastPlayerState = 'UNKNOWN';
    this.clearConsumedTimeout();
  }

  onPlayerStateChanged(playerState: TrackingPlayerState, positionSeconds?: number, liveAbsoluteTimeSeconds?: number): void {
    if (!this.currentPlayback) {
      return;
    }

    this.currentPlayback.liveAbsoluteTimeSeconds = liveAbsoluteTimeSeconds;

    const previousState = this.lastPlayerState;
    this.lastPlayerState = playerState;

    if (playerState === 'PLAYING' && previousState !== 'PLAYING') {
      this.track(StreamEvent.Started, positionSeconds);
      this.scheduleConsumed(positionSeconds);
      return;
    }

    if (playerState === 'PAUSED' && previousState !== 'PAUSED') {
      this.clearConsumedTimeout();
      this.track(StreamEvent.Paused, positionSeconds);
    }
  }

  onSeek(positionSeconds?: number): void {
    if (!this.currentPlayback) {
      return;
    }

    this.clearConsumedTimeout();
    this.track(StreamEvent.Seeked, positionSeconds);
  }

  onCompleted(positionSeconds?: number): void {
    if (!this.currentPlayback) {
      return;
    }

    this.clearConsumedTimeout();
    this.track(StreamEvent.Completed, positionSeconds);
    this.didTrackStreamConsumed = false;
    this.isSubsequent = false;
    this.lastPlayerState = 'UNKNOWN';
  }

  onStop(positionSeconds?: number): void {
    if (!this.currentPlayback) {
      return;
    }

    this.clearConsumedTimeout();
    this.track(StreamEvent.Stopped, positionSeconds);
    this.currentPlayback = undefined;
    this.didTrackStreamConsumed = false;
    this.isSubsequent = false;
    this.lastPlayerState = 'UNKNOWN';
  }

  disable(): void {
    this.clearConsumedTimeout();
    this.currentPlayback = undefined;
    this.didTrackStreamConsumed = false;
    this.isSubsequent = false;
    this.lastPlayerState = 'UNKNOWN';
    void this.analytics?.reset();
  }

  private async ensureAnalytics(): Promise<void> {
    if (this.analytics) {
      return;
    }

    this.analytics = AnalyticsBrowser.load({ writeKey: this.writeKey });
    this.analytics.addSourceMiddleware(({ payload, next }) => {
      if (payload.obj.type !== 'identify') {
        next(payload);
      }
    });
  }

  private scheduleConsumed(positionSeconds?: number): void {
    if (this.didTrackStreamConsumed || this.consumedTimeoutId !== null) {
      return;
    }

    const timeoutMs = this.isPreprod ? 60_000 : 10 * 60_000;
    this.consumedTimeoutId = window.setTimeout(() => {
      this.track(StreamEvent.Consumed, positionSeconds);
      if (this.currentPlayback?.isLive) {
        this.isSubsequent = true;
      }
      this.didTrackStreamConsumed = true;
      this.consumedTimeoutId = null;
    }, timeoutMs);
  }

  private clearConsumedTimeout(): void {
    if (this.consumedTimeoutId === null) {
      return;
    }

    window.clearTimeout(this.consumedTimeoutId);
    this.consumedTimeoutId = null;
  }

  private track(event: StreamEvent, positionSeconds?: number): void {
    if (!this.analytics || !this.currentPlayback) {
      return;
    }

    const profile = this.parseProfile(this.currentPlayback.profileId ?? this.profileId);
    if (!profile) {
      return;
    }

    const streamType = this.currentPlayback.isLive ? 'live' : 'on_demand';
    const properties: any = {
      profile_id: profile.profileId,
      is_logged_in: profile.isLoggedIn,
      playable_urn: this.currentPlayback.itemId ?? null,
      stream_type: streamType,
    };

    if (event === StreamEvent.Started && this.currentPlayback.senderDevice) {
      properties.sender_device = this.currentPlayback.senderDevice;
      properties.stream_format = this.currentPlayback.mimeType?.includes('video') ? 'video' : 'audio';
      properties.stream_play_reason = this.currentPlayback.autoPlayReason ?? 'manual';
    } else if (event === StreamEvent.Consumed) {
      properties.stream_play_reason = this.currentPlayback.autoPlayReason ?? 'manual';
    }

    if (!this.currentPlayback.isLive) {
      if (typeof positionSeconds === 'number' && Number.isFinite(positionSeconds)) {
        properties['stream_position'] = Math.floor(positionSeconds);
      }
    } else {
      if (event === StreamEvent.Consumed) {
        properties.stream_subsequently = this.isSubsequent;
      }

      if (
        typeof positionSeconds === 'number'
        && Number.isFinite(positionSeconds)
        && event !== StreamEvent.Completed
      ) {
        const absoluteTime = this.currentPlayback.liveAbsoluteTimeSeconds;
        if (typeof absoluteTime === 'number' && Number.isFinite(absoluteTime)) {
          properties.live_timestamp = new Date(absoluteTime * 1000).toISOString();
        }
      }
    }

    this.analytics.track(event, properties, {
      context: {
        consent: {
          categoryPreferences: {
            preferences: this.consents?.includes('preferences') ?? false,
            statistics: this.consents?.includes('statistics') ?? false,
          },
        },
        protocols: {
          event_version: 2,
        },
      },
    });
  }

  private parseProfile(rawProfileId?: string): { profileId: string; isLoggedIn: boolean } | null {
    if (!rawProfileId) {
      return null;
    }

    const profileArray = rawProfileId.split('|');
    if (profileArray.length !== 2) {
      return null;
    }

    return {
      isLoggedIn: profileArray[0].toLowerCase() === 'user',
      profileId: profileArray[1],
    };
  }

  private decodeProfileId(token?: string | null): string | null {
    if (!token) {
      return null;
    }

    try {
      const payload = token.split('.')[1];
      if (!payload) {
        return null;
      }

      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const decoded = JSON.parse(atob(padded)) as { sub?: string };
      return typeof decoded.sub === 'string' ? decoded.sub : null;
    } catch {
      return null;
    }
  }
}
