import { CastMediaItem, CastQueueState, CastTransport, CastUiOverrides } from '../common/types';
import { GoogleCastTransport } from './google-cast.transport';
import { MockCastTransport } from './mock-cast.transport';

export class HybridCastTransport implements CastTransport {
  readonly isSupported = true;

  private readonly googleTransport = new GoogleCastTransport();
  private readonly mockTransport = new MockCastTransport();
  private activeTransport: CastTransport = this.mockTransport;

  get name(): string {
    return this.activeTransport.name;
  }

  private chooseTransport(): CastTransport {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.activeTransport = this.googleTransport;
      return this.activeTransport;
    }

    this.activeTransport = this.mockTransport;
    return this.activeTransport;
  }

  async connect(state: CastQueueState): Promise<void> {
    const primaryTransport = this.chooseTransport();
    if (primaryTransport === this.googleTransport) {
      try {
        await primaryTransport.connect?.(state);
        return;
      } catch (error) {
        // On non-Chrome runtimes (for example iOS/Android webviews), the web sender SDK may be unavailable.
        // Fall back to mock transport so the SDK core still works with a platform-specific bridge transport.
        console.warn('[HybridCastTransport] Google Cast transport unavailable, falling back to mock transport.', error);
        this.activeTransport = this.mockTransport;
      }
    }

    await this.mockTransport.connect?.(state);
  }

  async loadQueue(state: CastQueueState): Promise<void> {
    await this.activeTransport.loadQueue?.(state);
  }

  async play(item: CastMediaItem, state: CastQueueState): Promise<void> {
    await this.activeTransport.play?.(item, state);
  }

  async toggleSubtitles(): Promise<boolean> {
    return await this.activeTransport.toggleSubtitles?.() ?? false;
  }

  async pause(state: CastQueueState): Promise<void> {
    await this.activeTransport.pause?.(state);
  }

  async stop(state: CastQueueState): Promise<void> {
    await this.activeTransport.stop?.(state);
  }

  async disconnect(): Promise<void> {
    await this.activeTransport.disconnect?.();
  }

  setUiOverrides(overrides: Partial<CastUiOverrides>): void {
    this.googleTransport.setUiOverrides?.(overrides);
    this.mockTransport.setUiOverrides?.(overrides);
  }
}
