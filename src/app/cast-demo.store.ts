import { Injectable, computed, signal } from '@angular/core';
import {
  CastSenderClient,
  GoogleCastLauncherDiagnostics,
  HybridCastTransport,
  SequentialQueueStrategy,
  createMediaItem,
  getGoogleCastLauncherDiagnostics,
  initializeGoogleCastLauncher,
} from '../sdk';

export interface VideoDraft {
  accessToken: string;
  path: string;
}

@Injectable({ providedIn: 'root' })
export class CastDemoStore {
  private readonly client = new CastSenderClient(
    new HybridCastTransport(),
    new SequentialQueueStrategy(),
    []
  );

  readonly state = signal(this.client.getState());
  readonly logs = signal<string[]>([]);
  readonly queueItems = computed(() => this.state().queue.items);
  readonly activeItem = computed(() => {
    const currentState = this.state();
    return currentState.queue.items.find((item) => item.id === currentState.queue.activeItemId) ?? null;
  });
  readonly queueCount = computed(() => this.queueItems().length);
  readonly launcherDiagnostics = signal<GoogleCastLauncherDiagnostics>(getGoogleCastLauncherDiagnostics());

  readonly draft = signal<VideoDraft>({
    accessToken: '',
    path: '',
  });

  constructor() {
    this.client.subscribe((nextState) => {
      this.state.set(nextState);
      this.logs.set(this.client.getLogs());
    });
    this.refreshLauncherDiagnostics();
    void initializeGoogleCastLauncher().finally(() => this.refreshLauncherDiagnostics());
  }

  private refreshLauncherDiagnostics(): void {
    this.launcherDiagnostics.set(getGoogleCastLauncherDiagnostics());
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } finally {
      this.refreshLauncherDiagnostics();
    }
  }

  async sendQueue(): Promise<void> {
    try {
      await this.client.sendQueue();
    } finally {
      this.refreshLauncherDiagnostics();
    }
  }

  async playSelected(): Promise<void> {
    try {
      await this.client.playSelected();
    } finally {
      this.refreshLauncherDiagnostics();
    }
  }

  async pause(): Promise<void> {
    await this.client.pause();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  addDraftVideo(): void {
    const currentDraft = this.draft();
    const trimmedPath = currentDraft.path.trim();
    if (!trimmedPath) {
      return;
    }

    const cleanedPath = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
    const pathLabel = cleanedPath.length > 64 ? `${cleanedPath.slice(0, 64)}...` : cleanedPath;

    this.client.enqueue(
      createMediaItem({
        title: `Path ${pathLabel}`,
        subtitle: currentDraft.accessToken.trim() ? 'Token attached' : 'No token',
        url: cleanedPath,
        mimeType: 'application/x-mpegURL',
        customData: {
          accessToken: currentDraft.accessToken.trim(),
          path: cleanedPath,
        },
      })
    );
  }

  updateDraft(patch: Partial<VideoDraft>): void {
    this.draft.update((current) => ({
      ...current,
      ...patch,
    }));
  }

  removeItem(itemId: string): void {
    this.client.remove(itemId);
  }

  moveItemUp(itemId: string): void {
    const index = this.queueItems().findIndex((item) => item.id === itemId);
    if (index > 0) {
      this.client.move(index, index - 1);
    }
  }

  moveItemDown(itemId: string): void {
    const index = this.queueItems().findIndex((item) => item.id === itemId);
    if (index >= 0 && index < this.queueItems().length - 1) {
      this.client.move(index, index + 1);
    }
  }

  clearQueue(): void {
    this.client.clear();
  }

  selectItem(itemId: string): void {
    this.client.select(itemId);
  }

  nextItem(): void {
    this.client.next();
  }

  previousItem(): void {
    this.client.previous();
  }

  isActive(itemId: string): boolean {
    return this.state().queue.activeItemId === itemId;
  }

  clearLogs(): void {
    this.logs.set([]);
  }
}
