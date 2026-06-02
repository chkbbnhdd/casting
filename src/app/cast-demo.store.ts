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
    id: 'nak-aed',
    title: 'Nak & Æd',
    subtitle: 'Nak & Æd: En bushbuck i Zambia',
    url: 'https://drod23q.akamaized.net/all/clear/none/b7/614333c4ac5a6114a4eec3b7/00951732070/stream_fmp4/master_manifest.m3u8',
    mimeType: 'application/x-mpegURL',
    posterUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg',
  }),
  createMediaItem({
    id: 'kontant',
    title: 'Kontant',
    subtitle: 'Kontant: Køkkenkrejlere',
    url: 'https://drod22k.akamaized.net/all/clear/none/bf/6a03673f0b31bf1bdc1337bf/00102609080/stream_fmp4/master_manifest.m3u8',
    mimeType: 'application/x-mpegURL',
    posterUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg',
  }),
  createMediaItem({
    id: 'manden-i-hullet',
    title: 'Manden i hullet',
    subtitle: 'Manden i hullet: To spader og en gammel myte',
    url: 'https://drod24s.akamaized.net/all/clear/none/a7/68fb7df57f141633447b35a7/00922514520/stream_fmp4/master_manifest.m3u8',
    mimeType: 'application/x-mpegURL',
    posterUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg',
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
  readonly logs = signal<string[]>([]);
  readonly queueItems = computed(() => this.state().queue.items);
  readonly activeItem = computed(() => {
    const currentState = this.state();
    return currentState.queue.items.find((item) => item.id === currentState.queue.activeItemId) ?? null;
  });
  readonly queueCount = computed(() => this.queueItems().length);
  readonly sampleVideos = sampleVideos;
  readonly launcherDiagnostics = signal<GoogleCastLauncherDiagnostics>(getGoogleCastLauncherDiagnostics());

  readonly draft = signal<VideoDraft>({
    title: 'Nak & Æd',
    url: 'https://drod23q.akamaized.net/all/clear/none/b7/614333c4ac5a6114a4eec3b7/00951732070/stream_fmp4/master_manifest.m3u8',
    mimeType: 'application/x-mpegURL',
    subtitle: 'Nak & Æd: En bushbuck i Zambia',
    posterUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg',
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

  clearLogs(): void {
    this.logs.set([]);
  }
}
