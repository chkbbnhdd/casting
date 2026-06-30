import { Injectable } from '@angular/core';
import { ManifestInfo } from '../tracking/manifest-info';

/**
 * Constructs the CAF `PlaybackConfig` and `CastReceiverOptions` used to start
 * the receiver context.
 *
 * ### Shaka configuration
 * - `availabilityWindowOverride: 1800` — allows seeking up to 30 min back in
 *   the HLS DVR buffer.
 * - `ignoreManifestProgramDateTime: true` — prevents Shaka from using
 *   `#EXT-X-PROGRAM-DATE-TIME` timestamps, which can cause seek loops on some
 *   DR TV streams.
 *
 * ### Auto-resume
 * - `autoResumeNumberOfSegments: 3` — waits for 3 buffered segments before
 *   resuming after a network interruption.
 *
 * ### Manifest handler
 * - Passes each manifest through {@link ManifestInfo.update} to extract the
 *   `#EXT-X-TARGETDURATION` used for live time offset calculations.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackConfigService {
  /**
   * Creates a `PlaybackConfig` instance with manifest handler and Shaka settings.
   *
   * @param manifestInfo - Shared manifest info instance updated during playback.
   * @returns Configured CAF `PlaybackConfig`.
   */
  createPlaybackConfig(manifestInfo: ManifestInfo): any {
    const playbackConfig = new (window as any).cast.framework.PlaybackConfig();

    playbackConfig.manifestHandler = (manifest: string | null) => manifestInfo.update(manifest);
    playbackConfig.autoResumeNumberOfSegments = 3;
    playbackConfig.shakaConfig = {
      manifest: {
        availabilityWindowOverride: 1800,
        hls: {
          ignoreManifestProgramDateTime: true,
        },
      },
      streaming: {
        bufferBehind: 30,
        bufferingGoal: 60,
        rebufferingGoal: 15,
      },
      drm: {
        retryParameters: {
          maxAttempts: 3,
          baseDelay: 100,
          backoffFactor: 2,
          maxDelay: 5000,
          timeout: 0,
        },
      },
    };

    return playbackConfig;
  }

  /**
   * Creates a `CastReceiverOptions` instance referencing the given config.
   *
   * Sets `useShakaForHls: true` and registers `customNamespace` for JSON messages.
   *
   * @param playbackConfig  - Config produced by {@link createPlaybackConfig}.
   * @param customNamespace - CAF custom channel namespace string.
   * @returns Configured CAF `CastReceiverOptions`.
   */
  createReceiverOptions(playbackConfig: any, customNamespace: string): any {
    const options = new (window as any).cast.framework.CastReceiverOptions();

    options.useShakaForHls = true;
    options.playbackConfig = playbackConfig;
    options.customNamespaces = {
      [customNamespace]: (window as any).cast.framework.system.MessageType.JSON,
    };
    options.disableIdleTimeout = false; // Allow CAF native idle timeout

    return options;
  }
}
