import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CastDemoStore, VideoDraft } from '../cast-demo.store';
import { ConfigService } from '../services/config.service';

@Component({
  selector: 'app-sender-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './sender-page.component.html',
  styleUrl: '../app.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class SenderPageComponent {
  private readonly randomPaths = [
    '/se/fortidens-hemmeligheder_-thomas-delaney_542879',
    '/se/nak-and-aed_-en-tjur-i-sverige_55454',
    '/se/manden-i-hullet_-to-spader-og-en-gammel-myte_552595',
    '/se/skattejaegerne_192328',
    '/se/indefra-med-anders-agger-_-gaden-i-grenaa_-retten-til-at-gaa-i-hundene_596290',
  ];

  protected readonly title = 'DR Sender Cast Tester';
  protected readonly store = inject(CastDemoStore);
  private readonly configService = inject(ConfigService);
  protected readonly queueItems = this.store.queueItems;
  protected readonly activeItem = this.store.activeItem;
  protected readonly queueCount = this.store.queueCount;
  protected readonly state = this.store.state;
  protected readonly logs = this.store.logs;
  protected readonly launcherDiagnostics = this.store.launcherDiagnostics;
  protected readonly draft = this.store.draft;
  protected readonly isTestingConfigUrl = signal(false);
  protected readonly configTestResponse = signal<string>('');
  protected readonly configTestError = signal<string | null>(null);

  protected onDraftChange(field: keyof VideoDraft, value: string): void {
    this.store.updateDraft({ [field]: value } as Partial<VideoDraft>);
  }

  protected setRandomPath(): void {
    const randomIndex = Math.floor(Math.random() * this.randomPaths.length);
    const randomPath = this.randomPaths[randomIndex] ?? this.randomPaths[0];
    this.store.updateDraft({ path: randomPath });
  }

  protected async testConfigUrl(): Promise<void> {
    this.isTestingConfigUrl.set(true);
    this.configTestError.set(null);
    this.configTestResponse.set('');

    try {
      const result = await this.configService.testConfig();

      if (result.isError) {
        this.configTestError.set(result.errorMessage ?? 'Request failed.');
      }

      this.configTestResponse.set(result.rendered);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.configTestError.set(message);
      this.configTestResponse.set(`Request failed: ${message}`);
    } finally {
      this.isTestingConfigUrl.set(false);
    }
  }

  protected openReceiverPreview(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.open('/receiver', '_blank', 'noopener,noreferrer');
  }

  protected clearLogs(): void {
    this.store.clearLogs();
  }
}