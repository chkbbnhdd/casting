import { Injectable } from '@angular/core';
import { BreakMetadataApplier } from './break-metadata-applier';

/**
 * Transforms a {@link ResolvedPlayback} result into a CAF `LoadRequestData`.
 *
 * Applied mutations:
 * - `media.contentId` / `contentUrl` / `contentType` / `streamType`
 * - `media.metadata.title`, `subtitle`, `images`
 * - `media.breakClips` + `media.breaks` (via {@link BreakMetadataApplier})
 * - `media.tracks` (text tracks) and `activeTrackIds`
 * - `autoplay = true`
 */
@Injectable({ providedIn: 'root' })
export class PlaybackDataMapper {
  constructor(private breakMetadataApplier: BreakMetadataApplier) {}

  /**
   * Mutates `loadRequestData` in-place with all data from `resolvedPlayback`.
   *
   * @param loadRequestData  - CAF `LoadRequestData` to populate.
   * @param resolvedPlayback - Result from {@link PlaybackResolver.resolve}.
   */
  applyToLoadRequest(loadRequestData: any, resolvedPlayback: any): void {
    if (!loadRequestData?.media) {
      return;
    }

    loadRequestData.autoplay = true;
    loadRequestData.media.contentId = resolvedPlayback.streamUrl;
    loadRequestData.media.contentUrl = resolvedPlayback.streamUrl;
    loadRequestData.media.contentType = resolvedPlayback.mimeType;
    loadRequestData.media.streamType = 'BUFFERED';

    this.applyMetadata(loadRequestData.media, resolvedPlayback);
    this.breakMetadataApplier.applyEmbeddedBreakMetadata(loadRequestData.media, resolvedPlayback.skipTimeCode);
    this.applyTextTracks(loadRequestData, resolvedPlayback);
  }

  /**
   * Apply title, subtitle, and poster to media metadata.
   */
  private applyMetadata(media: any, resolvedPlayback: any): void {
    const metadata = media.metadata ?? {};
    metadata.title = resolvedPlayback.title ?? metadata.title;
    metadata.subtitle = resolvedPlayback.subtitle ?? metadata.subtitle;

    if (resolvedPlayback.posterUrl) {
      metadata.images = [{ url: resolvedPlayback.posterUrl }];
    }

    media.metadata = metadata;
  }

  /**
   * Apply text tracks and set active tracks if subtitles enabled.
   */
  private applyTextTracks(loadRequestData: any, resolvedPlayback: any): void {
    const textTracks = resolvedPlayback.textTracks ?? [];
    const subtitlesEnabled = resolvedPlayback.subtitlesEnabled === true;

    if (textTracks.length) {
      loadRequestData.media.tracks = textTracks;
      loadRequestData.activeTrackIds =
        subtitlesEnabled && textTracks.length > 0
          ? [textTracks[0]?.trackId]
          : [];
    } else {
      loadRequestData.media.tracks = [];
      loadRequestData.activeTrackIds = [];
    }
  }
}
