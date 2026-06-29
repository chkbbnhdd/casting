import { ManifestInfo } from '../tracking/manifest-info';
import { EnrichedMediaStatus } from '../models/media-status.model';

/**
 * Enriches a raw CAF `MEDIA_STATUS` event with live-stream absolute time.
 *
 * @param event         - Raw CAF event object.
 * @param playerManager - CAF `PlayerManager` providing time conversion APIs.
 * @param manifestInfo  - Parsed manifest info containing the HLS time offset.
 * @returns {@link EnrichedMediaStatus} with player state and optional timestamps.
 */
export function enrichMediaStatus(
  event: any,
  playerManager: any,
  manifestInfo: ManifestInfo
): EnrichedMediaStatus {
  const playerState = event?.mediaStatus?.playerState ?? 'unknown';
  const currentTime = event?.currentMediaTime ?? playerManager.getCurrentTimeSec?.();

  // Calculate absolute time for live streams by subtracting manifest offset
  let liveAbsoluteTime: number | undefined;
  if (typeof currentTime === 'number' && Number.isFinite(currentTime)) {
    const liveAbsoluteTimeRaw = playerManager.getAbsoluteTimeForMediaTime?.(currentTime);
    if (typeof liveAbsoluteTimeRaw === 'number' && Number.isFinite(liveAbsoluteTimeRaw)) {
      liveAbsoluteTime = liveAbsoluteTimeRaw - manifestInfo.timeOffset;
    }
  }

  return {
    playerState,
    currentTime: typeof currentTime === 'number' && Number.isFinite(currentTime) ? currentTime : undefined,
    liveAbsoluteTime: typeof liveAbsoluteTime === 'number' && Number.isFinite(liveAbsoluteTime) ? liveAbsoluteTime : undefined,
  };
}
