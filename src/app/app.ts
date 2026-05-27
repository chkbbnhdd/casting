import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CastDemoStore, VideoDraft } from './cast-demo.store';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class App {
  protected readonly title = 'Cast queue lab';
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
}
