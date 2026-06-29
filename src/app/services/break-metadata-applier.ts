import { Injectable } from '@angular/core';
import { NormalizedTimeCode } from '../models/time-code.model';

/**
 * Applies skip-intro / skip-outro metadata to a CAF media object as an
 * **embedded break** so the Chromecast UI can offer a "Skip" button.
 *
 * CAF break model:
 * - A `BreakClip` describes the skippable segment (title, duration, `whenSkippable=0`).
 * - A `Break` positions the clip at `skipTimeCode.startTime` in the stream.
 * - Both objects are set on `media.breakClips` and `media.breaks`.
 *
 * When `skipTimeCode` is `null`, any existing breaks are cleared.
 */
@Injectable({ providedIn: 'root' })
export class BreakMetadataApplier {
  /**
   * Writes `breakClips` and `breaks` onto `media`.
   *
   * @param media        - CAF `MediaInformation` object to mutate.
   * @param skipTimeCode - Normalised skip time code, or `null` to clear breaks.
   */
  applyEmbeddedBreakMetadata(media: any, skipTimeCode: NormalizedTimeCode | null): void {
    if (!media) {
      return;
    }

    if (!skipTimeCode) {
      media.breakClips = [];
      media.breaks = [];
      return;
    }

    const breakClip = this.createBreakClip(skipTimeCode);
    const breakData = this.createBreak(skipTimeCode);

    media.breakClips = [breakClip];
    media.breaks = [breakData];
  }

  /**
   * Constructs a CAF `BreakClip` from the given time code.
   * Falls back to a plain object when the CAF constructor is unavailable (SSR/tests).
   */
  private createBreakClip(skipTimeCode: NormalizedTimeCode): any {
    const messages = (window as any).cast?.framework?.messages;
    const BreakClipCtor = messages?.BreakClip;
    const clipId = skipTimeCode.timeCodeType.trim().toLowerCase() || 'intro';

    const breakClip =
      typeof BreakClipCtor === 'function'
        ? new BreakClipCtor(clipId)
        : { id: clipId };

    breakClip.title = `Skip ${skipTimeCode.timeCodeType}`;
    breakClip.duration = Math.max(0, skipTimeCode.duration);
    breakClip.whenSkippable = 0;
    breakClip.embedded = true;

    return breakClip;
  }

  /**
   * Constructs a CAF `Break` that positions the clip at `startTime`.
   * Falls back to a plain object when the CAF constructor is unavailable (SSR/tests).
   */
  private createBreak(skipTimeCode: NormalizedTimeCode): any {
    const messages = (window as any).cast?.framework?.messages;
    const BreakCtor = messages?.Break;
    const clipId = skipTimeCode.timeCodeType.trim().toLowerCase() || 'intro';
    const breakId = `${clipId}-break`;

    const breakData =
      typeof BreakCtor === 'function'
        ? new BreakCtor(breakId, [clipId], Math.max(0, skipTimeCode.startTime))
        : {
            id: breakId,
            breakClipIds: [clipId],
            position: Math.max(0, skipTimeCode.startTime),
          };

    breakData.duration = Math.max(0, skipTimeCode.duration);
    breakData.isEmbedded = true;
    breakData.expanded = false;

    return breakData;
  }
}
