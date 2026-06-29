import { Injectable } from '@angular/core';
import { MediaFile } from '../../api/video-v1/model/mediaFile';
import { ResolvedPlayback } from '../models/playback.model';
import { NormalizedTimeCode } from '../models/time-code.model';
import { APIUrlBuilder } from './api-url-builder';
import { ItemIDExtractor } from './item-id-extractor';
import { AssetNegotiatorService } from './asset-negotiator.service';
import { SubtitleTrackBuilder } from './subtitle-track-builder';
import { TimeCodeNormalizer } from './time-code-normalizer';
import { SessionManager } from './session-manager';

/**
 * Orchestrates the full playback resolution pipeline for a queue item.
 *
 * Given a queue item containing a DR TV content path, this service:
 * 1. Normalises the path and fetches page metadata from the DR TV page API.
 * 2. Extracts the numeric item ID using {@link ItemIDExtractor}.
 * 3. Fetches available media streams from the video API (authenticated).
 * 4. Selects the best HLS file via {@link AssetNegotiatorService}.
 * 5. Resolves subtitle tracks via {@link SubtitleTrackBuilder}.
 * 6. Finds the skip-intro time code via {@link TimeCodeNormalizer}.
 * 7. Returns a fully-populated {@link ResolvedPlayback} ready for CAF.
 *
 * @see PlaybackDataMapper — applies the result to a CAF `LoadRequestData`.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackResolver {
  constructor(
    private apiUrlBuilder: APIUrlBuilder,
    private itemIdExtractor: ItemIDExtractor,
    private assetNegotiator: AssetNegotiatorService,
    private subtitleBuilder: SubtitleTrackBuilder,
    private timeCodeNormalizer: TimeCodeNormalizer,
    private sessionManager: SessionManager
  ) {}

  /**
   * Resolves complete playback information for a queue item.
   *
   * @param item                   - Queue item from the sender's `customData.queue.items`.
   * @param preferredAccessService - Access service requested by the sender (e.g. spoken subtitles).
   * @returns Fully-resolved {@link ResolvedPlayback}.
   * @throws If path is missing, item ID cannot be resolved, or no playable stream is found.
   */
  async resolve(item: any, preferredAccessService: string | null = null): Promise<ResolvedPlayback> {
    const normalizedPath = this.normalizePath(item?.url ?? item?.path);
    
    if (!normalizedPath) {
      throw new Error('Queue item path is missing.');
    }

    console.log('[PlaybackResolver] Step 1: Normalized path:', normalizedPath);

    // Fetch and parse page metadata
    let pageData;
    try {
      pageData = await this.fetchPageData(normalizedPath);
      console.log('[PlaybackResolver] Step 2: Page data fetched successfully');
    } catch (err: any) {
      console.error('[PlaybackResolver] Step 2 FAILED: Page fetch error -', err?.message ?? String(err));
      throw err;
    }

    const firstEntry = Array.isArray(pageData?.entries) ? pageData.entries[0] : null;
    const pageItem = firstEntry?.item;

    // Extract item ID
    let itemId;
    try {
      itemId = this.itemIdExtractor.extract(normalizedPath, pageItem);
      if (!itemId) {
        throw new Error('Unable to resolve item id from page response.');
      }
      console.log('[PlaybackResolver] Step 3: Item ID extracted:', itemId);
    } catch (err: any) {
      console.error('[PlaybackResolver] Step 3 FAILED: Item ID extraction error -', err?.message ?? String(err));
      throw err;
    }

    // Fetch and select video streams
    let mediaFiles;
    try {
      mediaFiles = await this.fetchMediaFiles(itemId);
      console.log('[PlaybackResolver] Step 4: Media files fetched, count:', mediaFiles?.length ?? 0);
    } catch (err: any) {
      console.error('[PlaybackResolver] Step 4 FAILED: Media fetch error -', err?.message ?? String(err));
      throw err;
    }

    let primaryFile: any;
    try {
      primaryFile = this.assetNegotiator.selectPlayableMediaFile(mediaFiles, preferredAccessService);
      const streamUrl = primaryFile?.url;

      if (!streamUrl) {
        throw new Error('No playable stream URL found in video response.');
      }
      console.log('[PlaybackResolver] Step 5: Primary file selected, URL:', streamUrl.substring(0, 100) + '...');
    } catch (err: any) {
      console.error('[PlaybackResolver] Step 5 FAILED: Media selection error -', err?.message ?? String(err));
      throw err;
    }

    // Extract metadata
    const skipTimeCode = this.extractSkipTimeCode(mediaFiles, 'Intro');
    const subtitles = this.subtitleBuilder.resolveSubtitleSource(
      mediaFiles,
      primaryFile!,
      preferredAccessService,
      (s) => this.isSpokenAccessService(s),
      (s) => this.isStandardAccessService(s)
    );

    const result = {
      itemId,
      streamUrl: primaryFile.url,
      mimeType: this.assetNegotiator.resolveMimeType(primaryFile),
      title: firstEntry?.title ?? pageData?.title ?? item?.title,
      subtitle: pageItem?.episodeName ?? pageItem?.showName ?? item?.subtitle,
      durationSeconds: this.extractDuration(pageItem),
      isLive: false,
      posterUrl: this.extractPosterUrl(pageItem, item),
      accessService: primaryFile?.accessService,
      subtitlesEnabled: this.isSpokenAccessService(preferredAccessService),
      textTracks: this.subtitleBuilder.buildTracks(subtitles),
      skipTimeCode,
    };

    console.log('[PlaybackResolver] ✓ Complete: Stream URL resolved successfully');
    return result;
  }

  /**
   * GETs page metadata for the given content path.
   *
   * @param path - Normalised content path starting with `/`.
   * @returns Parsed page JSON.
   * @throws If the HTTP request fails.
   */
  private async fetchPageData(path: string): Promise<any> {
    const pageUrl = this.apiUrlBuilder.buildPageUrl(path);
    const response = await fetch(pageUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Page request failed with ${response.status}`);
    }

    return response.json();
  }

  /**
   * GETs available media files for an item, authenticated with the session token.
   *
   * @param itemId - DR item identifier.
   * @returns Array of {@link MediaFile} objects.
   * @throws If no access token is present, or the request fails.
   */
  private async fetchMediaFiles(itemId: string): Promise<MediaFile[]> {
    const accessToken = this.sessionManager.getAccessToken();
    if (!accessToken) {
      throw new Error('Missing accessToken for protected video endpoint.');
    }

    const videoUrl = this.apiUrlBuilder.buildVideoUrl(itemId);
    const response = await fetch(videoUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken.trim()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Video request failed with ${response.status}`);
    }

    return response.json();
  }

  /**
   * Ensures the path starts with `/`. Returns `null` for empty input.
   *
   * @param rawPath - Raw path string from the queue item.
   */
  private normalizePath(rawPath: string | null): string | null {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return null;
    }

    const trimmed = rawPath.trim();
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }

  /**
   * Extracts the content duration in whole seconds.
   * Prefers `durationMilliseconds` over `duration` when both are present.
   */
  private extractDuration(pageItem: any): number | undefined {
    if (typeof pageItem?.durationMilliseconds === 'number') {
      return Math.floor(pageItem.durationMilliseconds / 1000);
    }

    if (typeof pageItem?.duration === 'number') {
      return pageItem.duration;
    }

    return undefined;
  }

  /**
   * Resolves the best available poster image URL.
   * Preference order: `tile` → `wallpaper` → `poster` → `item.posterUrl`.
   */
  private extractPosterUrl(pageItem: any, item: any): string | undefined {
    return pageItem?.images?.tile ?? pageItem?.images?.wallpaper ?? pageItem?.images?.poster ?? item?.posterUrl;
  }

  /**
   * Finds and normalises the skip time code (e.g. intro/outro) from all
   * available media files. Returns `null` if not found.
   *
   * @param mediaFiles  - All media files from the video API response.
   * @param targetType  - Time code type to search for (default: `'Intro'`).
   */
  private extractSkipTimeCode(
    mediaFiles: MediaFile[],
    targetType: string = 'Intro'
  ): NormalizedTimeCode | null {
    const allTimeCodes = mediaFiles.flatMap((file) =>
      Array.isArray(file?.timeCodes) ? file.timeCodes : []
    );

    return this.timeCodeNormalizer.findByType(allTimeCodes, targetType);
  }

  /**
   * Check if access service is for spoken subtitles.
   */
  private isSpokenAccessService(accessService: string | null | undefined): boolean {
    const normalized = this.normalizeAccessServiceName(accessService);
    return normalized.includes('spoken') && normalized.includes('subtitle');
  }

  /**
   * Check if access service is standard video.
   */
  private isStandardAccessService(accessService: string | null | undefined): boolean {
    const normalized = this.normalizeAccessServiceName(accessService);
    return normalized.includes('standard') && normalized.includes('video');
  }

  /**
   * Normalize access service name.
   */
  private normalizeAccessServiceName(accessService: string | null | undefined): string {
    if (typeof accessService !== 'string') {
      return '';
    }

    return accessService.trim().toLowerCase().replace(/[^a-z]/g, '');
  }
}

