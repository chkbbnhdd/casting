import { ContentProvider } from './content-provider';

/**
 * Content provider for on-demand (VOD) content.
 * Handles on-demand-specific behavior: progress tracking, completion, etc.
 */
export class OnDemandContentProvider extends ContentProvider {
  private startTime: number = 0;

  constructor(private contentData: any) {
    super();
  }

  onPlaybackStart(): void {
    this.startTime = Date.now();
  }

  onPlaybackPause(): void {
    // Pause tracking
  }

  onPlaybackStop(): void {
    // Stop tracking
    this.dispose();
  }

  onSeek(positionSeconds: number): void {
    // Handle seek in VOD timeline
  }

  getContentMetadata(): any {
    return {
      isLive: false,
      contentData: this.contentData,
      duration: this.contentData?.duration,
      startTime: this.startTime,
    };
  }

  dispose(): void {
    // Cleanup for on-demand content
  }

  /**
   * Get elapsed playback time since playback started.
   */
  getElapsedSeconds(): number {
    return (Date.now() - this.startTime) / 1000;
  }
}
