import { Injectable } from '@angular/core';
import { TimeCodes } from '../../api/video-v1/model/timeCodes';
import { NormalizedTimeCode } from '../models/time-code.model';

/**
 * Normalises raw time code objects from the DR TV video API.
 *
 * The API may return times in either milliseconds or seconds. This service
 * detects the unit by checking whether the duration exceeds 1 000 and divides
 * accordingly, producing a consistent {@link NormalizedTimeCode} in **seconds**.
 *
 * Invalid time codes (non-finite values, `endTime ≤ startTime`) are rejected.
 */
@Injectable({ providedIn: 'root' })
export class TimeCodeNormalizer {
  /**
   * Converts a raw {@link TimeCodes} object to a validated {@link NormalizedTimeCode}.
   *
   * @param timeCode - Raw time code from the video API.
   * @returns Normalised time code in seconds, or `null` if the input is invalid.
   */
  normalize(timeCode: TimeCodes): NormalizedTimeCode | null {
    if (!timeCode || typeof timeCode.timeCodeType !== 'string' || typeof timeCode.startTime !== 'number') {
      return null;
    }

    const rawStart = timeCode.startTime;
    const rawEnd = typeof timeCode.endTime === 'number' ? timeCode.endTime : rawStart;
    const rawDuration = typeof timeCode.duration === 'number' ? timeCode.duration : rawEnd - rawStart;

    // Detect if values are milliseconds (> 1000 is typically milliseconds)
    const looksLikeMilliseconds = rawDuration > 1000 || rawEnd - rawStart > 1000;
    const divisor = looksLikeMilliseconds ? 1000 : 1;

    const startTime = rawStart / divisor;
    const duration = Math.max(0, rawDuration / divisor);
    const endTime = rawEnd > rawStart ? rawEnd / divisor : startTime + duration;

    if (!isFinite(startTime) || !isFinite(endTime) || endTime <= startTime) {
      return null;
    }

    return {
      startTime,
      endTime,
      duration: duration > 0 ? duration : endTime - startTime,
      timeCodeType: timeCode.timeCodeType,
    };
  }

  /**
   * Searches an array of raw time codes for the first one whose `timeCodeType`
   * matches `targetType` (case-insensitive) and returns the normalised result.
   *
   * @param timeCodes  - Array of raw time codes to search.
   * @param targetType - Type string to match (e.g. `'Intro'`).
   * @returns The first matching {@link NormalizedTimeCode}, or `null`.
   */
  findByType(timeCodes: TimeCodes[], targetType: string): NormalizedTimeCode | null {
    return (
      timeCodes
        .map((tc) => this.normalize(tc))
        .find((tc) => tc?.timeCodeType.toLowerCase() === targetType.toLowerCase()) ?? null
    );
  }
}

