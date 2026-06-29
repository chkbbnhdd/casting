import { TrackingPlaybackContext } from '../models/tracking.model';
import { NpawOptions } from '../models/tracking-options.model';

export class NPAWManager {
  private plugin: any;
  private adapterReady = false;
  private enabled = true;

  constructor(private readonly options: NpawOptions) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async initialize(playerManager: any, profileId?: string | null): Promise<void> {
    if (!this.enabled || this.plugin) {
      return;
    }

    try {
      const youboraModule = await import('youboralib');
      await import('youbora-adapter-chromecastcaf');

      const youbora: any = (youboraModule as any).default ?? (youboraModule as any);
      this.plugin = new youbora.Plugin({ accountCode: this.options.accountCode });
      this.plugin.setOptions({
        username: profileId ?? undefined,
        'device.name': 'Chromecast',
        'app.name': this.options.appName,
        'app.releaseVersion': this.options.appVersion,
      });

      this.plugin.setAdapter(new youbora.adapters.ChromecastCAF(playerManager));
      this.adapterReady = true;
    } catch (error) {
      console.warn('NPAW initialization failed', error);
      this.adapterReady = false;
    }
  }

  configurePlayback(context: TrackingPlaybackContext): void {
    if (!this.enabled || !this.plugin || !this.adapterReady) {
      return;
    }

    this.plugin.setOptions({
      'content.id': context.itemId ?? context.streamUrl ?? undefined,
      'content.isLive': context.isLive === true,
      'content.title': context.title ?? undefined,
      'content.episodeTitle': context.subtitle ?? undefined,
      'content.duration': context.durationSeconds,
      'content.type': context.mimeType?.includes('video') ? 'video' : 'audioonly',
    });
  }

  updateProfileId(profileId?: string | null): void {
    if (!this.plugin) {
      return;
    }

    this.plugin.setOptions({ username: profileId ?? undefined });
  }

  stop(): void {
    this.plugin?.fireStop?.();
  }
}
