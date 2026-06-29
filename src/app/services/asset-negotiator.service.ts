import { Injectable } from '@angular/core';
import { MediaFile } from '../../api/video-v1/model/mediaFile';

/**
 * Selects the optimal media file from the DR TV video API response.
 *
 * Selection priority:
 * 1. If a `preferredAccessService` is specified, find an HLS file with a
 *    matching access service; fall back to the first matching file.
 * 2. HLS file with a **standard video** access service.
 * 3. Any HLS file that is not a spoken-subtitle variant.
 * 4. First playable file (any format).
 *
 * Access service names are normalised (trimmed, lowercased, non-alpha stripped)
 * before comparison to handle inconsistent casing from the API.
 */
@Injectable({ providedIn: 'root' })
export class AssetNegotiatorService {
  /**
   * Selects the best playable {@link MediaFile} from `mediaFiles`.
   *
   * @param mediaFiles             - All files returned by the video API.
   * @param preferredAccessService - Sender-requested access service name, or `null`.
   * @returns The selected {@link MediaFile}, or `null` if none are playable.
   */
  selectPlayableMediaFile(mediaFiles: MediaFile[], preferredAccessService: string | null = null): MediaFile | null {
    const playableFiles = mediaFiles.filter((file) => !!file.url);

    if (playableFiles.length === 0) {
      return null;
    }

    // If preferred service specified, find matching candidates
    if (preferredAccessService) {
      const preferredCandidates = playableFiles.filter((file) =>
        this.accessServiceMatches(file.accessService, preferredAccessService)
      );
      if (preferredCandidates.length > 0) {
        return (
          preferredCandidates.find((file) => file.format === 'video/hls') ?? preferredCandidates[0] ?? null
        );
      }
    }

    // Prefer HLS format
    const hlsFiles = playableFiles.filter((file) => file.format === 'video/hls');
    const candidates = hlsFiles.length > 0 ? hlsFiles : playableFiles;

    // Prefer standard video access service
    return (
      candidates.find((file) => this.isStandardAccessService(file.accessService)) ??
      candidates.find((file) => !this.isSpokenAccessService(file.accessService)) ??
      candidates[0] ??
      null
    );
  }

  /**
   * Returns the MIME type for the given media file.
   * Always `'application/x-mpegURL'` (HLS) for Chromecast.
   *
   * @param _mediaFile - Unused; kept for interface consistency.
   */
  resolveMimeType(_mediaFile: MediaFile): string {
    return 'application/x-mpegURL';
  }

  /**
   * Returns `true` if `actual` and `preferred` refer to the same access service.
   *
   * Both values are normalised before comparison. Spoken-subtitle and
   * standard-video services are matched categorically rather than by exact string.
   *
   * @param actual    - Access service from a {@link MediaFile}.
   * @param preferred - Access service requested by the sender.
   */
  accessServiceMatches(actual: string | null | undefined, preferred: string | null | undefined): boolean {
    const normalizedActual = this.normalizeAccessServiceName(actual);
    const normalizedPreferred = this.normalizeAccessServiceName(preferred);

    if (!normalizedActual || !normalizedPreferred) {
      return false;
    }

    // Match spoken/subtitle access service
    if (this.isSpokenAccessService(normalizedPreferred)) {
      return this.isSpokenAccessService(normalizedActual);
    }

    // Match standard video access service
    if (this.isStandardAccessService(normalizedPreferred)) {
      return this.isStandardAccessService(normalizedActual);
    }

    // Fallback: exact match
    return normalizedActual === normalizedPreferred;
  }

  /**
   * Normalizes access service names by trimming, lowercasing, and removing non-alphanumeric chars.
   * Examples: "Spoken Subtitles" -> "spokensubtitles", " STANDARD VIDEO " -> "standardvideo"
   */
  private normalizeAccessServiceName(accessService: string | null | undefined): string {
    if (typeof accessService !== 'string') {
      return '';
    }

    return accessService.trim().toLowerCase().replace(/[^a-z]/g, '');
  }

  /**
   * Checks if access service is for spoken subtitles/descriptions.
   */
  private isSpokenAccessService(accessService: string | null | undefined): boolean {
    const normalized = this.normalizeAccessServiceName(accessService);
    return normalized.includes('spoken') && normalized.includes('subtitle');
  }

  /**
   * Checks if access service is standard video (no accessibility modifications).
   */
  private isStandardAccessService(accessService: string | null | undefined): boolean {
    const normalized = this.normalizeAccessServiceName(accessService);
    return normalized.includes('standard') && normalized.includes('video');
  }
}
