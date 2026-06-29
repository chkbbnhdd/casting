import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DeltatreAxisDisplayContentFrontendHostApiService } from '../../api/display-fe-axis-https/api/deltatreAxisDisplayContentFrontendHostApi.service';

export interface ConfigTestResult {
  rendered: string;
  isError: boolean;
  errorMessage?: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly configTenantIdUnderTest = 'drdk';
  private readonly configParamsUnderTest = {
    device: 'chromecast',
    include: 'classification,subscription,sitemap,navigation,general,i18n,playback,linear,featureFlags',
    lang: 'da',
    segments: 'drtv',
    sub: 'Registered',
  };

  private readonly axisDisplayApi = inject(DeltatreAxisDisplayContentFrontendHostApiService);

  async testConfig(): Promise<ConfigTestResult> {
    try {
      const response = await firstValueFrom(
        this.axisDisplayApi.getConfig(
          this.configTenantIdUnderTest,
          this.configParamsUnderTest.include,
          this.configParamsUnderTest.device,
          this.configParamsUnderTest.sub,
          this.configParamsUnderTest.segments,
          this.configParamsUnderTest.lang,
          'response'
        )
      );

      const body = JSON.stringify(response.body ?? {}, null, 2);
      const rendered = `HTTP ${response.status} ${response.statusText ?? ''}\n\n${body}`;
      const isError = response.status < 200 || response.status >= 300;

      return {
        rendered,
        isError,
        errorMessage: isError ? 'Request failed.' : undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        rendered: `Request failed: ${message}`,
        isError: true,
        errorMessage: message,
      };
    }
  }
}
