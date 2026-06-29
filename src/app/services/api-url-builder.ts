import { Injectable, Inject } from '@angular/core';

/**
 * Constructs API endpoint URLs for the DR TV page and video services.
 *
 * Standard query parameters (device, language, geo, feature flags) are applied
 * automatically so callers only need to supply the path or item ID.
 *
 * Injection tokens required:
 * - `'PAGE_ENDPOINT_BASE_URL'` — base URL for the page/metadata API
 * - `'VIDEO_ENDPOINT_BASE_URL'` — base URL for the video/streams API
 * - `'VIDEO_ENDPOINT_DEVICE'`  — device identifier (e.g. `'chromecast'`)
 */
@Injectable({ providedIn: 'root' })
export class APIUrlBuilder {
  constructor(
    @Inject('PAGE_ENDPOINT_BASE_URL') private pageEndpointBaseUrl: string,
    @Inject('VIDEO_ENDPOINT_BASE_URL') private videoEndpointBaseUrl: string,
    @Inject('VIDEO_ENDPOINT_DEVICE') private videoEndpointDevice: string
  ) {}

  /**
   * Builds a fully-qualified page metadata URL.
   *
   * Appends standard Chromecast query parameters:
   * `device`, `ff`, `geoLocation`, `lang`, `sub`, `item_detail_expand`,
   * `list_page_size`, `max_list_prefetch`, `segments`, `text_entry_format`.
   *
   * @param path - Content path (e.g. `/program/episode-slug_12345678`).
   * @returns Fully-qualified URL string.
   */
  buildPageUrl(path: string): string {
    const query = new URLSearchParams({
      device: 'chromecast',
      ff: 'idp,ldp,rpt',
      geoLocation: 'dk',
      isDeviceAbroad: 'false',
      item_detail_expand: 'all',
      lang: 'da',
      list_page_size: '24',
      max_list_prefetch: '3',
      path,
      segments: 'drtv,optedin',
      sub: 'Registered',
      text_entry_format: 'html',
    });

    return `${this.pageEndpointBaseUrl}?${query.toString()}`;
  }

  /**
   * Builds a fully-qualified video streams URL.
   *
   * Appends standard parameters: `delivery`, `device`, `ff`, `geoLocation`,
   * `lang`, `resolution` (HD-1080), `sub`.
   *
   * @param itemId - DR item identifier (numeric string).
   * @returns Fully-qualified URL string.
   */
  buildVideoUrl(itemId: string): string {
    const query = new URLSearchParams({
      delivery: 'stream',
      device: this.videoEndpointDevice,
      ff: 'idp,ldp,rpt',
      geoLocation: 'dk',
      lang: 'da',
      resolution: 'HD-1080',
      sub: 'Registered',
    });

    return `${this.videoEndpointBaseUrl}/${encodeURIComponent(itemId)}/videos?${query.toString()}`;
  }
}
