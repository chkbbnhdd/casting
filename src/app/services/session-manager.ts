import { Injectable } from '@angular/core';
import { SessionContext, SessionUpdateMessage } from '../models/session.model';

/**
 * Manages the receiver's authentication session state.
 *
 * Session data arrives over the CAF custom channel as a `sessionUpdate` message
 * (see {@link SessionUpdateMessage}). This service validates, stores, and
 * provides access to tokens, segment identifiers, and the anonymous tracking ID.
 *
 * Tokens are never logged in plain text — use {@link maskToken} for debug output.
 */
@Injectable({ providedIn: 'root' })
export class SessionManager {
  private session: SessionContext = {
    accessToken: null,
    idToken: null,
    segments: [],
    anonymousId: null,
  };

  /**
   * Parses and validates a raw custom-channel message.
   *
   * Accepts either a pre-parsed object or a JSON string. Returns `null` if the
   * message is missing required fields or has an unexpected `type`.
   *
   * @param data - Raw payload from the CAF custom message event.
   * @returns A validated {@link SessionUpdateMessage}, or `null`.
   */
  parseSessionUpdateMessage(data: unknown): SessionUpdateMessage | null {
    let candidate = data;

    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        return null;
      }
    }

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const message = candidate as Partial<SessionUpdateMessage>;
    if (message.type !== 'sessionUpdate') {
      return null;
    }

    if (typeof message.auth?.accessToken !== 'string' || typeof message.auth?.idToken !== 'string') {
      return null;
    }

    if (!Array.isArray(message.segments) || !message.segments.every((segment) => typeof segment === 'string')) {
      return null;
    }

    if (typeof message.tracking?.anonymousId !== 'string') {
      return null;
    }

    return {
      type: 'sessionUpdate',
      auth: {
        accessToken: message.auth.accessToken,
        idToken: message.auth.idToken,
      },
      segments: [...message.segments],
      tracking: {
        anonymousId: message.tracking.anonymousId,
      },
    };
  }

  /**
   * Persists a validated session update into the internal state.
   *
   * @param update - A validated {@link SessionUpdateMessage}.
   */
  updateSession(update: SessionUpdateMessage): void {
    this.session = {
      accessToken: update.auth.accessToken,
      idToken: update.auth.idToken,
      segments: [...update.segments],
      anonymousId: update.tracking.anonymousId,
    };
  }

  /**
   * Returns a shallow copy of the current session context.
   *
   * @returns Current {@link SessionContext}.
   */
  getSession(): SessionContext {
    return { ...this.session };
  }

  /**
   * Returns the current access token, or `null` if no session has been set.
   * Used by {@link PlaybackResolver} to authorise video API requests.
   */
  getAccessToken(): string | null {
    return this.session.accessToken;
  }

  /**
   * Returns a redacted version of a JWT for safe display in debug overlays.
   *
   * Tokens with 12 or fewer characters are returned as-is. Longer tokens show
   * the first 6 and last 4 characters separated by `...`.
   *
   * @param token - Raw token string.
   * @returns Masked string (e.g. `eyJhbG...a1b2`).
   */
  maskToken(token: string): string {
    if (token.length <= 12) {
      return token;
    }
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
  }
}

