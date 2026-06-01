import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
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
  protected readonly title = 'DR Cast Tester';
  protected readonly store = inject(CastDemoStore);
  protected readonly queueItems = this.store.queueItems;
  protected readonly activeItem = this.store.activeItem;
  protected readonly queueCount = this.store.queueCount;
  protected readonly state = this.store.state;
  protected readonly launcherDiagnostics = this.store.launcherDiagnostics;
  protected readonly draft = this.store.draft;
  protected readonly sampleVideos = this.store.sampleVideos;
  protected readonly highlights = [
    'Queue strategy first',
    'Angular as the test harness',
    'Ready for native adapters',
  ];

  protected onDraftChange(field: keyof VideoDraft, value: string): void {
    this.store.updateDraft({ [field]: value } as Partial<VideoDraft>);
  }

  protected openReceiverPreview(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.open('/receiver', '_blank', 'noopener,noreferrer');
  }
}