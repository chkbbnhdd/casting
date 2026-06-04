import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CastDemoStore, VideoDraft } from '../cast-demo.store';

@Component({
  selector: 'app-sender-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './sender-page.component.html',
  styleUrl: '../app.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class SenderPageComponent {
  private readonly configUrlUnderTest =
    'https://prod95-cdn.dr-massive.com/api/config?device=web_browser&ff=idp%2Cldp%2Crpt&include=classification%2Csubscription%2Csitemap%2Cnavigation%2Cgeneral%2Ci18n%2Cplayback%2Clinear%2CfeatureFlags&lang=da&segments=drtv&sub=Registered';

  protected readonly title = 'DR Sender Cast Tester';
  protected readonly store = inject(CastDemoStore);
  protected readonly queueItems = this.store.queueItems;
  protected readonly activeItem = this.store.activeItem;
  protected readonly queueCount = this.store.queueCount;
  protected readonly state = this.store.state;
  protected readonly logs = this.store.logs;
  protected readonly launcherDiagnostics = this.store.launcherDiagnostics;
  protected readonly draft = this.store.draft;
  protected readonly sampleVideos = this.store.sampleVideos;
  protected readonly isTestingConfigUrl = signal(false);
  protected readonly configTestResponse = signal<string>('');
  protected readonly configTestError = signal<string | null>(null);

  protected onDraftChange(field: keyof VideoDraft, value: string): void {
    this.store.updateDraft({ [field]: value } as Partial<VideoDraft>);
  }

  protected async testConfigUrl(): Promise<void> {
    this.isTestingConfigUrl.set(true);
    this.configTestError.set(null);
    this.configTestResponse.set('');

    try {
      const response = await fetch(this.configUrlUnderTest, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      const contentType = response.headers.get('content-type') ?? '';
      const body = contentType.includes('application/json')
        ? JSON.stringify(await response.json(), null, 2)
        : await response.text();

      const rendered = `HTTP ${response.status} ${response.statusText}\n\n${body}`;

      if (!response.ok) {
        this.configTestError.set('Request failed.');
      }

      this.configTestResponse.set(rendered);
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