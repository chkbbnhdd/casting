/**
 * Parses and caches HLS manifest metadata needed for live-stream time conversion.
 *
 * The CAF framework reports player time as seconds relative to the beginning of
 * the HLS availability window. To convert this to a wall-clock time, we need to
 * know the `#EXT-X-TARGETDURATION` value from the manifest.
 *
 * `timeOffset` is set to `3 × targetDuration` (the number of segments the
 * Chromecast buffers before the live edge) and is subtracted from the absolute
 * time returned by `getAbsoluteTimeForMediaTime()` to get the true live time.
 *
 * @example
 * ```ts
 * const info = new ManifestInfo();
 * playbackConfig.manifestHandler = (manifest) => info.update(manifest);
 * const wallClock = absoluteTime - info.timeOffset;
 * ```
 */
export class ManifestInfo {
  /** Regex matching the `#EXT-X-TARGETDURATION` line in an HLS manifest. */
  static readonly targetDurationRegex = /#EXT-X-TARGETDURATION:(\d+(?:\.\d+)?)/;

  /** Duration in seconds of each HLS segment (defaults to 6 s). */
  targetDuration: number;
  /** Time offset in seconds to subtract from absolute player time (= 3 × targetDuration). */
  timeOffset: number;

  constructor() {
    this.targetDuration = 6;
    this.timeOffset = 3 * this.targetDuration;
  }

  /**
   * Parses a manifest string and updates {@link targetDuration} and {@link timeOffset}
   * if a valid `#EXT-X-TARGETDURATION` tag is found.
   *
   * Called by the CAF `PlaybackConfig.manifestHandler` on every manifest fetch.
   *
   * @param manifest - Raw HLS manifest text, or `null`.
   * @returns The manifest string unchanged (required by the CAF manifest handler API).
   */
  update(manifest: string | null): string {
    if (!manifest) {
      return manifest ?? '';
    }

    this.updateTargetDuration(manifest);
    return manifest;
  }

  private updateTargetDuration(manifest: string): void {
    const result = ManifestInfo.targetDurationRegex.exec(manifest);
    if (!(result && result.length > 1)) {
      return;
    }

    const targetDuration = Number.parseFloat(result[1]);
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
      return;
    }

    this.targetDuration = targetDuration;
    this.timeOffset = 3 * this.targetDuration;
    console.log(`Setting target duration to ${this.targetDuration}`);
  }
}
