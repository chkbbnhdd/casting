import { AnalyticsManager } from './analytics-manager';
import { NPAWManager } from './npaw-manager';
import {
  TrackingFeatureFlags,
  TrackingPlaybackContext,
  TrackingPlayerState,
  TrackingSessionContext,
} from '../models/tracking.model';
import { TrackingManagerOptions } from '../models/tracking-options.model';

/**
 * Coordinates all analytics tracking for the CAF receiver.
 *
 * Acts as a facade over two providers:
 * - **Segment** (`AnalyticsManager`) — event-level tracking (Started, Playing, Seek, etc.)
 * - **NPAW / Youbora** (`NPAWManager`) — quality-of-experience monitoring
 *
 * Feature flags received from the receiver config control whether NPAW is active.
 * The JWT `sub` claim is decoded from the access or ID token to identify the user
 * profile in NPAW without requiring a separate profile API call.
 */
export class TrackingManager {
  private readonly analyticsManager: AnalyticsManager;
  private readonly npawManager: NPAWManager;
  private session?: TrackingSessionContext;

  constructor(options: TrackingManagerOptions) {
    this.analyticsManager = new AnalyticsManager(options.isPreprod);
    this.npawManager = new NPAWManager({
      appName: options.appName,
      appVersion: options.appVersion,
      accountCode: options.isPreprod ? 'drdkdev' : 'drdkprodlyd',
    });
  }

  /**
   * Applies remote feature flags to the NPAW manager.
   * NPAW is disabled when `disableNPAW` is `true` or `npawEnabled` is `false`.
   *
   * @param flags - Feature flags from the receiver config response.
   */
  updateFeatureFlags(flags: TrackingFeatureFlags): void {
    const enabled = flags.disableNPAW !== true && flags.npawEnabled !== false;
    this.npawManager.setEnabled(enabled);
  }

  /**
   * Initialises the NPAW adapter with the CAF `PlayerManager`.
   * Should be called once after the receiver context starts.
   *
   * @param playerManager - CAF `PlayerManager` instance.
   */
  async initialize(playerManager: any): Promise<void> {
    const profileId = this.decodeProfileId(this.session?.idToken) ?? this.decodeProfileId(this.session?.accessToken);
    await this.npawManager.initialize(playerManager, profileId);
  }

  /**
   * Updates session context in both analytics providers and decodes the
   * profile ID from the JWT for NPAW.
   *
   * @param session - New session context from the custom channel.
   */
  async updateSession(session: TrackingSessionContext): Promise<void> {
    this.session = session;
    await this.analyticsManager.updateSession(session);

    const profileId = this.decodeProfileId(session.idToken) ?? this.decodeProfileId(session.accessToken);
    this.npawManager.updateProfileId(profileId);
  }

  /**
   * Notifies both providers that a new item has loaded.
   *
   * @param playback - Metadata for the item about to play.
   */
  onLoad(playback: TrackingPlaybackContext): void {
    this.analyticsManager.setPlayback(playback);
    this.npawManager.configurePlayback(playback);
  }

  /**
   * Forwards a player state change to Segment analytics.
   *
   * @param playerState              - Typed player state.
   * @param positionSeconds          - Current playback position in seconds.
   * @param liveAbsoluteTimeSeconds  - Absolute wall-clock time for live streams.
   */
  onPlayerState(playerState: TrackingPlayerState, positionSeconds?: number, liveAbsoluteTimeSeconds?: number): void {
    this.analyticsManager.onPlayerStateChanged(playerState, positionSeconds, liveAbsoluteTimeSeconds);
  }

  /**
   * Notifies Segment that the user initiated a seek.
   *
   * @param positionSeconds - Position from which the seek started.
   */
  onSeek(positionSeconds?: number): void {
    this.analyticsManager.onSeek(positionSeconds);
  }

  /**
   * Notifies Segment and NPAW that playback completed naturally.
   *
   * @param positionSeconds - Final playback position at completion.
   */
  onCompleted(positionSeconds?: number): void {
    this.analyticsManager.onCompleted(positionSeconds);
    this.npawManager.stop();
  }

  /**
   * Notifies Segment and NPAW that playback was interrupted (e.g. new LOAD).
   *
   * @param positionSeconds - Position at the time of the stop.
   */
  onStop(positionSeconds?: number): void {
    this.analyticsManager.onStop(positionSeconds);
    this.npawManager.stop();
  }

  /** Disables all analytics providers. Call in `ngOnDestroy`. */
  destroy(): void {
    this.analyticsManager.disable();
    this.npawManager.stop();
  }

  /**
   * Decodes the `sub` claim from a JWT without verifying the signature.
   * Returns `null` for missing, malformed, or unsigned tokens.
   *
   * @param token - Raw JWT string.
   * @returns Profile ID string, or `null`.
   */
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
