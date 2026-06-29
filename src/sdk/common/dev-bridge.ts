/**
 * Development bridge for local sender/receiver communication.
 * Enables testing cast functionality without a real Chromecast device.
 * Uses localStorage to communicate between sender and receiver pages.
 */

export interface DevBridgeMessage {
  type: 'loadQueue' | 'play' | 'pause' | 'stop' | 'sessionUpdate' | 'connect' | 'disconnect';
  timestamp: number;
  payload: any;
}

export class DevBridge {
  private static readonly STORAGE_KEY = 'dr-cast-dev-bridge';
  private static readonly POLL_INTERVAL = 100; // ms
  private messageListener: ((msg: any) => void) | null = null;
  private pollingInterval: number | null = null;
  private lastProcessedTimestamp: Record<string, number> = {}; // Track per message type

  /**
   * Start listening for messages from the other page (sender or receiver).
   */
  startListening(onMessage: (message: any) => void): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return;
    }

    this.messageListener = onMessage;

    // Poll for new messages from the OTHER page (listen on opposite keys)
    this.pollingInterval = window.setInterval(() => {
      try {
        // Check both transport and session update messages
        this.checkMessageType('loadQueue');
        this.checkMessageType('sessionUpdate');
        this.checkMessageType('play');
        this.checkMessageType('pause');
        this.checkMessageType('stop');
      } catch (error) {
        console.error('[DevBridge] Error processing messages:', error);
      }
    }, DevBridge.POLL_INTERVAL);

    console.log('[DevBridge] Listening for messages');
  }

  /**
   * Check for new messages of a specific type from the other page.
   */
  private checkMessageType(messageType: string): void {
    const listeningKey = this.getListeningKey(messageType);
    const data = localStorage.getItem(listeningKey);
    if (!data) return;

    try {
      const message = JSON.parse(data) as DevBridgeMessage;

      // Skip if we've already processed this exact message
      const lastTimestamp = this.lastProcessedTimestamp[messageType] ?? 0;
      if (message.timestamp <= lastTimestamp) {
        return;
      }

      this.lastProcessedTimestamp[messageType] = message.timestamp;
      this.messageListener?.(message);
    } catch (error) {
      console.error(`[DevBridge] Error processing ${messageType}:`, error);
    }
  }

  /**
   * Send a message to the other page.
   */
  sendMessage(type: string, payload: any): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return;
    }

    try {
      const message: DevBridgeMessage = {
        type: type as any,
        timestamp: Date.now(),
        payload,
      };

      // Store with type-specific key so messages don't overwrite each other
      const storageKey = this.getStorageKey(type);
      localStorage.setItem(storageKey, JSON.stringify(message));
      console.log('[DevBridge] Message sent:', type, payload);
    } catch (error) {
      console.error('[DevBridge] Error sending message:', error);
    }
  }

  /**
   * Stop listening for messages.
   */
  stopListening(): void {
    if (this.pollingInterval !== null) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.messageListener = null;
      console.log('[DevBridge] Stopped listening');
    }
  }

  /**
   * Get the storage key based on current page type and message type.
   */
  private getStorageKey(messageType: string): string {
    if (typeof window === 'undefined') {
      return DevBridge.STORAGE_KEY;
    }

    // Sender writes to 'from-sender', Receiver writes to 'from-receiver'
    const isSender = window.location.pathname === '/' || !window.location.pathname.includes('receiver');
    const fromPart = isSender ? 'from-sender' : 'from-receiver';
    return `${DevBridge.STORAGE_KEY}-${fromPart}-${messageType}`;
  }

  /**
   * Get the key to listen on (opposite of what we write to, with message type).
   */
  private getListeningKey(messageType: string): string {
    if (typeof window === 'undefined') {
      return DevBridge.STORAGE_KEY;
    }

    // Sender listens on 'from-receiver', Receiver listens on 'from-sender'
    const isSender = window.location.pathname === '/' || !window.location.pathname.includes('receiver');
    const fromPart = isSender ? 'from-receiver' : 'from-sender';
    return `${DevBridge.STORAGE_KEY}-${fromPart}-${messageType}`;
  }
}

export const devBridge = new DevBridge();
