import {
  CastMediaItem,
  CastQueueState,
  CastQueueStrategy,
  CastSenderState,
  CastTransport,
  CastUiOverrides,
  defaultCastUiOverrides,
} from '../types';
import { cloneQueueState, createEmptyQueueState, mergeUiOverrides, nowIso } from '../utils';
import { SequentialQueueStrategy } from '../queue/sequential-queue.strategy';

type CastStateListener = (state: CastSenderState) => void;

function formatCastError(error: unknown): string {
  if (error instanceof Error) {
    const causeMessage = error.cause instanceof Error ? ` Cause: ${error.cause.message}` : '';
    return `${error.message}${causeMessage}`;
  }

  if (typeof error === 'object' && error !== null) {
    const maybeCastError = error as { code?: unknown; description?: unknown; details?: unknown; reason?: unknown };
    const details = [
      typeof maybeCastError.code === 'string' ? `code=${maybeCastError.code}` : null,
      typeof maybeCastError.reason === 'string' ? `reason=${maybeCastError.reason}` : null,
      typeof maybeCastError.description === 'string' ? maybeCastError.description : null,
      typeof maybeCastError.details === 'string' ? maybeCastError.details : null,
    ].filter((value): value is string => Boolean(value));

    if (details.length > 0) {
      return details.join(' | ');
    }
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown cast error.';
}

export class CastSenderClient {
  private readonly listeners = new Set<CastStateListener>();
  private state: CastSenderState;

  constructor(
    private readonly transport: CastTransport,
    private readonly queueStrategy: CastQueueStrategy = new SequentialQueueStrategy(),
    initialQueue: CastMediaItem[] = [],
    uiOverrides: Partial<CastUiOverrides> = {}
  ) {
    this.state = {
      queue: this.queueStrategy.seed(initialQueue),
      connected: false,
      sdkReady: transport.isSupported,
      transportName: transport.name,
      statusMessage: transport.isSupported
        ? `Ready to connect with ${transport.name}`
        : 'No cast transport is available in this environment.',
      lastError: null,
      uiOverrides: mergeUiOverrides(defaultCastUiOverrides, uiOverrides),
    };

    this.transport.setUiOverrides?.(this.state.uiOverrides);
  }

  subscribe(listener: CastStateListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): CastSenderState {
    return {
      ...this.state,
      queue: cloneQueueState(this.state.queue),
      uiOverrides: { ...this.state.uiOverrides },
    };
  }

  getState(): CastSenderState {
    return this.snapshot();
  }

  private emit(nextState: CastSenderState): void {
    this.state = nextState;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private setQueue(queue: CastQueueState, statusMessage: string, lastError: string | null = null): void {
    this.emit({
      ...this.state,
      queue,
      statusMessage,
      lastError,
    });
  }

  async connect(): Promise<void> {
    if (!this.transport.isSupported) {
      this.emit({
        ...this.state,
        connected: false,
        sdkReady: false,
        statusMessage: 'Cast transport is not available.',
        lastError: 'No cast transport is available in this environment.',
      });
      return;
    }

    this.emit({
      ...this.state,
      statusMessage: `Connecting through ${this.transport.name}...`,
      lastError: null,
    });

    try {
      await this.transport.connect?.(this.state.queue);
      const connectedState: CastSenderState = {
        ...this.state,
        connected: true,
        sdkReady: true,
        transportName: this.transport.name,
        statusMessage: `Connected through ${this.transport.name}.`,
        lastError: null,
      };
      this.emit(connectedState);

      if (connectedState.queue.items.length > 0) {
        await this.loadQueue();
      }
    } catch (error) {
      const message = formatCastError(error);
      this.emit({
        ...this.state,
        connected: false,
        sdkReady: false,
        statusMessage: 'Could not connect to a Cast receiver.',
        lastError: message,
      });
    }
  }

  async loadQueue(): Promise<void> {
    if (!this.transport.isSupported) {
      this.setQueue(
        this.state.queue,
        'Cannot load queue because cast transport is unavailable.',
        'No cast transport is available in this environment.'
      );
      return;
    }

    try {
      await this.transport.loadQueue?.(this.state.queue);
      this.emit({
        ...this.state,
        statusMessage: `Queue sent through ${this.transport.name}.`,
        lastError: null,
      });
    } catch (error) {
      const message = formatCastError(error);
      this.emit({
        ...this.state,
        statusMessage: 'Failed to send queue to Cast receiver.',
        lastError: message,
      });
    }
  }

  enqueue(item: CastMediaItem): void {
    const nextQueue = this.queueStrategy.append(this.state.queue, [item]);
    this.setQueue(nextQueue, `${item.title} added to the queue.`);
  }

  enqueueMany(items: CastMediaItem[]): void {
    if (items.length === 0) {
      return;
    }

    const nextQueue = this.queueStrategy.append(this.state.queue, items);
    this.setQueue(nextQueue, `${items.length} videos added to the queue.`);
  }

  replaceQueue(items: CastMediaItem[]): void {
    const nextQueue = this.queueStrategy.replace(this.state.queue, items);
    this.setQueue(nextQueue, items.length > 0 ? 'Queue replaced.' : 'Queue cleared.');
  }

  select(itemId: string): void {
    const nextQueue = this.queueStrategy.select(this.state.queue, itemId);
    if (nextQueue === this.state.queue) {
      return;
    }

    this.setQueue(nextQueue, 'Queue item selected for playback.');
  }

  remove(itemId: string): void {
    const nextQueue = this.queueStrategy.remove(this.state.queue, itemId);
    this.setQueue(nextQueue, 'Queue item removed.');
  }

  move(fromIndex: number, toIndex: number): void {
    const nextQueue = this.queueStrategy.move(this.state.queue, fromIndex, toIndex);
    this.setQueue(nextQueue, 'Queue order updated.');
  }

  next(): void {
    const nextQueue = this.queueStrategy.advance(this.state.queue);
    this.setQueue(nextQueue, 'Advanced to the next queue item.');
  }

  previous(): void {
    const nextQueue = this.queueStrategy.rewind(this.state.queue);
    this.setQueue(nextQueue, 'Moved back to the previous queue item.');
  }

  clear(): void {
    const nextQueue = this.queueStrategy.replace(createEmptyQueueState(), []);
    this.setQueue(nextQueue, 'Queue cleared.');
  }

  async sendQueue(): Promise<void> {
    await this.loadQueue();
  }

  async playSelected(): Promise<void> {
    const activeItem = this.state.queue.items.find((item) => item.id === this.state.queue.activeItemId) ?? null;
    if (!activeItem) {
      this.emit({
        ...this.state,
        statusMessage: 'Pick a video before playing.',
        lastError: 'No queue item is currently selected.',
      });
      return;
    }

    try {
      await this.transport.play?.(activeItem, this.state.queue);
      this.setQueue(this.queueStrategy.select(this.state.queue, activeItem.id), `${activeItem.title} is now active.`);
    } catch (error) {
      const message = formatCastError(error);
      this.emit({
        ...this.state,
        statusMessage: `Could not start ${activeItem.title}.`,
        lastError: message,
      });
    }
  }

  async pause(): Promise<void> {
    try {
      await this.transport.pause?.(this.state.queue);
      this.emit({
        ...this.state,
        queue: {
          ...this.state.queue,
          status: 'paused',
          lastUpdatedIso: nowIso(),
        },
        statusMessage: 'Playback paused.',
        lastError: null,
      });
    } catch (error) {
      const message = formatCastError(error);
      this.emit({
        ...this.state,
        statusMessage: 'Could not pause playback.',
        lastError: message,
      });
    }
  }

  async stop(): Promise<void> {
    try {
      await this.transport.stop?.(this.state.queue);
      this.emit({
        ...this.state,
        queue: {
          ...this.state.queue,
          status: 'idle',
          lastUpdatedIso: nowIso(),
        },
        connected: false,
        statusMessage: 'Playback stopped.',
        lastError: null,
      });
    } catch (error) {
      const message = formatCastError(error);
      this.emit({
        ...this.state,
        statusMessage: 'Could not stop playback.',
        lastError: message,
      });
    }
  }

  updateUiOverrides(overrides: Partial<CastUiOverrides>): void {
    const nextOverrides = mergeUiOverrides(this.state.uiOverrides, overrides);
    this.emit({
      ...this.state,
      uiOverrides: nextOverrides,
      statusMessage: 'UI overrides updated for the sender shell.',
    });
    this.transport.setUiOverrides?.(overrides);
  }
}
