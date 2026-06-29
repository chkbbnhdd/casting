import { Injectable, signal } from '@angular/core';

/**
 * Lightweight logging service for the CAF receiver.
 *
 * All log entries are prefixed with a locale time string and stored in a
 * reactive Angular signal capped at {@link maxLogs} entries (LIFO order).
 * The `logs` signal can be bound directly in the debug overlay template.
 *
 * Entries are also written to `console.log` for DevTools inspection.
 */
@Injectable({ providedIn: 'root' })
export class ReceiverLogger {
  private readonly _logs = signal<string[]>([]);
  private readonly maxLogs = 200;

  /** Reactive signal containing the most recent log entries (newest first). */
  readonly logs = this._logs.asReadonly();

  /**
   * Appends a timestamped entry to the log signal and writes to `console.log`.
   *
   * @param message - Message text to record.
   */
  log(message: string): void {
    const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
    this._logs.update((current) => [entry, ...current].slice(0, this.maxLogs));
    console.log(message);
  }

  /**
   * Record receiver event if debug overlay is enabled.
   * Throttles noisy events to prevent spam.
   */
  recordEvent(
    eventName: string,
    details: string | undefined,
    showDebugOverlay: boolean,
    throttleMs: number
  ): void {
    const summary = details ? `${eventName}: ${details}` : eventName;
    this.log(summary);

    if (!showDebugOverlay) {
      return;
    }

    // Event throttling is handled by the component that calls this
  }

  /**
   * Clears all entries from the log signal.
   */
  clear(): void {
    this._logs.set([]);
  }

  /**
   * Returns the current number of stored log entries.
   */
  getLogCount(): number {
    return this._logs().length;
  }
}
