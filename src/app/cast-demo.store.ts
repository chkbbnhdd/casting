import { Injectable, computed, signal } from '@angular/core';
import {
  CastMediaItem,
  CastSenderClient,
  GoogleCastLauncherDiagnostics,
  HybridCastTransport,
  SequentialQueueStrategy,
  createMediaItem,
  getGoogleCastLauncherDiagnostics,
  initializeGoogleCastLauncher,
} from '../sdk';

export interface VideoDraft {
  title: string;
  url: string;
  mimeType: string;
  subtitle: string;
  posterUrl: string;
}

const sampleVideos: CastMediaItem[] = [
  createMediaItem({
    id: 'big-buck-bunny',
    title: 'Big Buck Bunny',
    subtitle: 'Google-hosted MP4 sample',
    url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    mimeType: 'video/mp4',
    posterUrl: 'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg?x11217',
  }),
  createMediaItem({
    id: 'elephants-dream',
    title: 'Elephants Dream',
    subtitle: 'Google-hosted MP4 sample',
    url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    mimeType: 'video/mp4',
    posterUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg',
  }),
  createMediaItem({
    id: 'tears-of-steel',
    title: 'Tears of Steel',
    subtitle: 'Google-hosted MP4 sample',
    url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    mimeType: 'video/mp4',
    posterUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/TearsOfSteel.jpg',
  }),
];

@Injectable({ providedIn: 'root' })
export class CastDemoStore {
  private readonly client = new CastSenderClient(
    new HybridCastTransport(),
    new SequentialQueueStrategy(),
    sampleVideos.slice(0, 1)
  );

  readonly state = signal(this.client.getState());
  readonly queueItems = computed(() => this.state().queue.items);
  readonly activeItem = computed(() => {
    const currentState = this.state();
    return currentState.queue.items.find((item) => item.id === currentState.queue.activeItemId) ?? null;
  });
  readonly queueCount = computed(() => this.queueItems().length);
  readonly sampleVideos = sampleVideos;
  readonly launcherDiagnostics = signal<GoogleCastLauncherDiagnostics>(getGoogleCastLauncherDiagnostics());

  readonly draft = signal<VideoDraft>({
    title: 'Big Buck Bunny',
    url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    mimeType: 'video/mp4',
    subtitle: 'Add your own queue entry',
    posterUrl: 'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg?x11217',
  });

  constructor() {
    this.client.subscribe((nextState) => this.state.set(nextState));
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

  addSampleVideo(index: number): void {
    const item = this.sampleVideos[index];
    if (!item) {
      return;
    }

    this.client.enqueue(item);
  }

  addAllSamples(): void {
    this.client.enqueueMany(this.sampleVideos);
  }

  addDraftVideo(): void {
    const currentDraft = this.draft();
    if (!currentDraft.title.trim() || !currentDraft.url.trim()) {
      return;
    }

    this.client.enqueue(
      createMediaItem({
        title: currentDraft.title.trim(),
        url: currentDraft.url.trim(),
        mimeType: currentDraft.mimeType.trim() || 'video/mp4',
        subtitle: currentDraft.subtitle.trim() || undefined,
        posterUrl: currentDraft.posterUrl.trim() || undefined,
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
}
