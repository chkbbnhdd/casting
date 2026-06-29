import { Injectable } from '@angular/core';
import { MediaFile } from '../../api/video-v1/model/mediaFile';
import { Subtitles } from '../../api/video-v1/model/subtitles';

/**
 * Constructs CAF `Track` objects from DR TV subtitle data.
 *
 * Track properties set:
 * - `trackContentId` — VTT file URL
 * - `trackContentType` — normalised MIME type (default `text/vtt`)
 * - `language` — BCP 47 code (e.g. `da`, `und`)
 * - `subtype` — `'CAPTIONS'` for hearing-impaired, `'SUBTITLES'` otherwise
 * - `isInband: false` — sidecar tracks only
 *
 * Subtitle source resolution priority:
 * 1. Subtitles embedded in the selected media file.
 * 2. Subtitles from a spoken-subtitle variant file.
 * 3. Any file with subtitles (unless a standard service was requested).
 */
@Injectable({ providedIn: 'root' })
export class SubtitleTrackBuilder {
  /**
   * Finds the best subtitle source from the available media files.
   *
   * @param mediaFiles             - All media files from the video API.
   * @param selectedFile           - The primary media file selected for playback.
   * @param preferredAccessService - Sender-requested access service name.
   * @param isSpokenAccessService  - Predicate that returns `true` for spoken-subtitle services.
   * @param isStandardAccessService - Predicate that returns `true` for standard-video services.
   * @returns Subtitle array, `null` (no subtitles for standard service), or `undefined` (not found).
   */
  resolveSubtitleSource(
    mediaFiles: MediaFile[],
    selectedFile: MediaFile,
    preferredAccessService: string | null,
    isSpokenAccessService: (service: string | null) => boolean,
    isStandardAccessService: (service: string | null) => boolean
  ): Subtitles[] | null | undefined {
    // First try selected file subtitles
    if (Array.isArray(selectedFile.subtitles) && selectedFile.subtitles.length > 0) {
      return selectedFile.subtitles;
    }

    // Try spoken/accessibility subtitles
    const spokenCandidate = mediaFiles.find(
      (file) =>
        isSpokenAccessService(file.accessService) &&
        Array.isArray(file.subtitles) &&
        file.subtitles.length > 0
    );
    if (spokenCandidate) {
      return spokenCandidate.subtitles;
    }

    // If standard service preferred, don't fallback
    if (preferredAccessService && isStandardAccessService(preferredAccessService)) {
      return null;
    }

    // Fallback to any available subtitles
    const fallbackCandidate = mediaFiles.find(
      (file) => Array.isArray(file.subtitles) && file.subtitles.length > 0
    );
    return fallbackCandidate?.subtitles;
  }

  /**
   * Converts a {@link Subtitles} array into CAF `Track` objects.
   *
   * Only subtitles with a valid `link` URL are included. If the CAF SDK is not
   * available (e.g. tests), plain objects with the same shape are returned.
   *
   * @param subtitles - Raw subtitle entries from the video API.
   * @returns Array of CAF `Track`-compatible objects.
   */
  buildTracks(subtitles: Subtitles[] | null | undefined): any[] {
    if (!Array.isArray(subtitles) || subtitles.length === 0) {
      return [];
    }

    const messages = (window as any).cast?.framework?.messages;
    const TrackCtor = messages?.Track;
    const TrackType = messages?.TrackType;

    return subtitles
      .filter((subtitle) => typeof subtitle?.link === 'string' && !!subtitle.link)
      .map((subtitle, index) => {
        const track =
          typeof TrackCtor === 'function'
            ? new TrackCtor(index + 1, TrackType?.TEXT ?? 'TEXT')
            : {
                trackId: index + 1,
                type: TrackType?.TEXT ?? 'TEXT',
              };

        track.trackId = track.trackId ?? index + 1;
        track.trackContentId = subtitle.link;
        track.trackContentType = this.normalizeMimeType(subtitle.format);
        track.language = this.normalizeLanguage(subtitle.language);
        track.name = subtitle.language || `Subtitle ${index + 1}`;
        track.subtype = this.mapSubtype(subtitle.language);
        track.isInband = false;

        return track;
      });
  }

  /**
   * Normalize subtitle MIME type.
   */
  private normalizeMimeType(format: string | null | undefined): string {
    if (typeof format !== 'string' || !format.trim()) {
      return 'text/vtt';
    }

    return format.split(';')[0]?.trim() || 'text/vtt';
  }

  /**
   * Normalize language code to BCP 47 format.
   */
  private normalizeLanguage(language: string | null | undefined): string {
    if (typeof language !== 'string' || !language.trim()) {
      return 'da';
    }

    const normalized = language.trim();
    if (/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/i.test(normalized)) {
      return normalized.toLowerCase();
    }

    if (/combined|hearing|caption/i.test(normalized)) {
      return 'da';
    }

    return 'und';
  }

  /**
   * Map language to track subtype (CAPTIONS for hearing impaired, SUBTITLES otherwise).
   */
  private mapSubtype(language: string | null | undefined): string {
    return /combined|hearing|caption/i.test(language ?? '') ? 'CAPTIONS' : 'SUBTITLES';
  }
}
