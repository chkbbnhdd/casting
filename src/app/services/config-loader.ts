import { Injectable } from '@angular/core';
import { TrackingFeatureFlags } from '../models/tracking.model';

/**
 * Fetches and caches the receiver configuration from the DR TV config API.
 *
 * The config response may contain `featureFlags` at various nesting levels;
 * {@link extractTrackingFeatureFlags} normalises all known locations.
 *
 * @example
 * ```ts
 * await this.configLoader.loadConfig(CONFIG_ENDPOINT_URL);
 * const flags = this.configLoader.extractTrackingFeatureFlags(this.configLoader.getConfigResponse());
 * trackingManager.updateFeatureFlags(flags);
 * ```
 */
@Injectable({ providedIn: 'root' })
export class ConfigLoader {
  private configResponse: any = null;

  /**
   * GETs the receiver config JSON from `configEndpointUrl` and caches it.
   *
   * @param configEndpointUrl - Absolute URL for the config endpoint.
   * @returns Parsed JSON response.
   * @throws If the HTTP request fails or returns a non-OK status.
   */
  async loadConfig(configEndpointUrl: string): Promise<any> {
    const response = await fetch(configEndpointUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Config request failed with ${response.status}`);
    }

    this.configResponse = await response.json();
    return this.configResponse;
  }

  /**
   * Returns the cached config response from the last {@link loadConfig} call.
   * Returns `null` if `loadConfig` has not yet been called.
   */
  getConfigResponse(): any {
    return this.configResponse;
  }

  /**
   * Extracts tracking feature flags from a config response.
   *
   * Searches `featureFlags`, `result.featureFlags`, `general.featureFlags`,
   * and `data.featureFlags` (in that order) to tolerate varying API shapes.
   *
   * @param configJson - Raw config response object.
   * @returns {@link TrackingFeatureFlags} with `npawEnabled` and/or `disableNPAW`.
   */
  extractTrackingFeatureFlags(configJson: unknown): TrackingFeatureFlags {
    const config = configJson as any;
    const candidateFlags = [
      config?.featureFlags,
      config?.result?.featureFlags,
      config?.general?.featureFlags,
      config?.data?.featureFlags,
    ];

    const featureFlags = candidateFlags.find((value) => value && typeof value === 'object') as any;
    if (!featureFlags) {
      return {};
    }

    return {
      npawEnabled: typeof featureFlags.npawEnabled === 'boolean' ? featureFlags.npawEnabled : undefined,
      disableNPAW: typeof featureFlags.disableNPAW === 'boolean' ? featureFlags.disableNPAW : undefined,
    };
  }
}

