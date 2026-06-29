/**
 * Abstract base class for content providers.
 * Encapsulates content-specific logic (live vs on-demand) for playback management.
 * 
 * Extracted from radio-cc-receiver pattern for better separation of concerns
 * when handling complex stream scenarios (schedule tracking, DVR metadata, etc.).
 */
export abstract class ContentProvider {
  /**
   * Called when content should start playing.
   */
  abstract onPlaybackStart(): void;

  /**
   * Called when content should pause.
   */
  abstract onPlaybackPause(): void;

  /**
   * Called when content stops/ends.
   */
  abstract onPlaybackStop(): void;

  /**
   * Called when user seeks to a position.
   */
  abstract onSeek(positionSeconds: number): void;

  /**
   * Gets current content metadata.
   */
  abstract getContentMetadata(): any;

  /**
   * Cleanup method - cancel timers, stop polling, etc.
   */
  abstract dispose(): void;
}
