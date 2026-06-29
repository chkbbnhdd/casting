import { Injectable, signal } from '@angular/core';
import { ReceiverDebugState, ReceiverUiState } from '../models/receiver-ui.model';

/**
 * Manages the receiver's UI state and debug overlay state as Angular signals.
 *
 * UI state transitions:
 * - `awaiting-cast`  — no sender connected
 * - `connected-idle` — sender connected but not playing
 * - `playing`        — stream is active (PLAYING / BUFFERING / LOADING)
 *
 * The `debugState` signal holds all fields shown in the debug overlay panel
 * and is updated incrementally via {@link updateDebugState}.
 */
@Injectable({ providedIn: 'root' })
export class UIStateManager {
  private readonly _uiState = signal<ReceiverUiState>('awaiting-cast');
  private readonly _debugState = signal<ReceiverDebugState>({
    path: null,
    pageUrl: null,
    pageStatus: null,
    itemId: null,
    videoUrl: null,
    videoStatus: null,
    streamUrl: null,
    contentType: null,
    sessionAccessToken: null,
    sessionIdToken: null,
    sessionSegments: [],
    sessionAnonymousId: null,
    sessionUpdatedAt: null,
    playerState: null,
    lastEvent: null,
    lastError: null,
    skipTimeCode: null,
  });

  /** Readonly signal representing the current high-level UI state. */
  readonly uiState = this._uiState.asReadonly();
  /** Readonly signal containing all fields for the debug overlay. */
  readonly debugState = this._debugState.asReadonly();

  /**
   * Derives and sets the UI state from current playback and connection flags.
   *
   * @param isPlaying          - `true` when the player is PLAYING/BUFFERING/LOADING.
   * @param hasSenderConnected - `true` once any Cast sender has connected.
   */
  updateFromPlaybackState(isPlaying: boolean, hasSenderConnected: boolean): void {
    if (isPlaying) {
      this._uiState.set('playing');
      return;
    }

    if (hasSenderConnected) {
      this._uiState.set('connected-idle');
      return;
    }

    this._uiState.set('awaiting-cast');
  }

  /**
   * Merges `patch` into the current debug state (non-destructive update).
   *
   * @param patch - Partial {@link ReceiverDebugState} fields to overwrite.
   */
  updateDebugState(patch: Partial<ReceiverDebugState>): void {
    this._debugState.update((current) => ({
      ...current,
      ...patch,
    }));
  }

  /** Resets all debug state fields to `null` / empty defaults. */
  resetDebugState(): void {
    this._debugState.set({
      path: null,
      pageUrl: null,
      pageStatus: null,
      itemId: null,
      videoUrl: null,
      videoStatus: null,
      streamUrl: null,
      contentType: null,
      sessionAccessToken: null,
      sessionIdToken: null,
      sessionSegments: [],
      sessionAnonymousId: null,
      sessionUpdatedAt: null,
      playerState: null,
      lastEvent: null,
      lastError: null,
      skipTimeCode: null,
    });
  }
}

