import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { BASE_PATH as DISPLAY_AXIS_BASE_PATH } from '../api/display-fe-axis-https/variables';
import { BASE_PATH as VIDEO_V1_BASE_PATH } from '../api/video-v1/variables';
import { routes } from './app.routes';

declare global {
  var __DISPLAY_AXIS_API_BASE_URL__: string | undefined;
  var __VIDEO_V1_API_BASE_URL__: string | undefined;
}

function resolveDisplayAxisBasePath(): string {
  return globalThis.__DISPLAY_AXIS_API_BASE_URL__ ?? '';
}

function resolveVideoV1BasePath(): string {
  return globalThis.__VIDEO_V1_API_BASE_URL__ ?? '';
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient(),
    { provide: DISPLAY_AXIS_BASE_PATH, useFactory: resolveDisplayAxisBasePath },
    { provide: VIDEO_V1_BASE_PATH, useFactory: resolveVideoV1BasePath },
  ]
};
