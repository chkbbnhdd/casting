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
  private readonly randomPaths = [
    '/se/fortidens-hemmeligheder_-thomas-delaney_542879',
    '/se/nak-and-aed_-en-tjur-i-sverige_55454',
    '/se/manden-i-hullet_-to-spader-og-en-gammel-myte_552595',
    '/se/skattejaegerne_192328',
    '/se/indefra-med-anders-agger-_-gaden-i-grenaa_-retten-til-at-gaa-i-hundene_596290',
  ];

  protected readonly title = 'DR Sender Cast Tester';
  protected readonly store = inject(CastDemoStore);
  protected readonly queueItems = this.store.queueItems;
  protected readonly activeItem = this.store.activeItem;
  protected readonly queueCount = this.store.queueCount;
  protected readonly state = this.store.state;
  protected readonly logs = this.store.logs;
  protected readonly launcherDiagnostics = this.store.launcherDiagnostics;
  protected readonly draft = this.store.draft;

  protected onDraftChange(field: keyof VideoDraft, value: string): void {
    this.store.updateDraft({ [field]: value } as Partial<VideoDraft>);
  }

  protected setRandomPath(): void {
    const randomIndex = Math.floor(Math.random() * this.randomPaths.length);
    const randomPath = this.randomPaths[randomIndex] ?? this.randomPaths[0];
    this.store.updateDraft({ path: randomPath });
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