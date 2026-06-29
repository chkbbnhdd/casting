import { ManifestInfo } from '../tracking/manifest-info';

/**
 * Intercepts and adjusts a CAF `REQUEST_SEEK` message for both live and VOD.
 *
 * Two client API versions are supported:
 *
 * **New API** (detected by `customData.deviceType` + `customData.receiverVersion`):
 * - Converts an absolute `seekDate` timestamp to a media-time position using
 *   `getMediaTimeForAbsoluteTime`, then adds the manifest time offset back.
 * - Falls back to the live seekable range end if conversion fails.
 *
 * **Legacy API** (all other senders):
 * - Honours a `seekToLive` flag, or clamps the target time to the seekable range.
 * - Translates relative seek positions to absolute by adding `liveSeekableRange.start`.
 *
 * @param seekRequest   - CAF `SeekRequestData` to mutate.
 * @param playerManager - CAF `PlayerManager` providing live range and time conversion.
 * @param manifestInfo  - Parsed manifest info containing the HLS time offset.
 * @returns The (mutated) `seekRequest`.
 */
export function handleSeekRequest(
  seekRequest: any,
  playerManager: any,
  manifestInfo: ManifestInfo
): any {
  const customData = seekRequest.customData ?? {};
  const liveSeekableRange = playerManager.getLiveSeekableRange?.();

  // New client API: Handle seekDate with version detection
  if (customData.deviceType && customData.receiverVersion) {
    const seekDateTime = customData.seekDate;
    if (seekDateTime) {
      // Convert absolute date to media time
      let seekTime = playerManager.getMediaTimeForAbsoluteTime?.(seekDateTime);
      if (seekTime) {
        // Add back the 3-segment offset that Chromecast subtracts
        seekTime += manifestInfo.timeOffset;
        seekRequest.currentTime = seekTime;
      } else if (liveSeekableRange) {
        // Can't convert date - seek to live end
        seekRequest.currentTime = liveSeekableRange.end;
      }
    }
  } else if (liveSeekableRange) {
    // Legacy client API: Handle relative seeks with seekToLive flag
    if (customData.seekToLive || (seekRequest.currentTime && seekRequest.currentTime > liveSeekableRange.end)) {
      seekRequest.currentTime = liveSeekableRange.end;
    } else {
      seekRequest.currentTime = seekRequest.currentTime + liveSeekableRange.start;
    }
  }

  return seekRequest;
}
