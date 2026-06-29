import { NormalizedTimeCode } from './time-code.model';

export interface ResolvedPlayback {
  streamUrl: string;
  mimeType: string;
  title?: string;
  subtitle?: string;
  posterUrl?: string;
  accessService?: string | null;
  subtitlesEnabled?: boolean;
  textTracks?: any[];
  skipTimeCode?: NormalizedTimeCode | null;
  itemId?: string | null;
  durationSeconds?: number;
  isLive?: boolean;
}
