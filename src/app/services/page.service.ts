import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DeltatreAxisDisplayContentFrontendHostApiService } from '../../api/display-fe-axis-https/api/deltatreAxisDisplayContentFrontendHostApi.service';
import { GetPageResult } from '../../api/display-fe-axis-https/model/getPageResult';

@Injectable({ providedIn: 'root' })
export class PageService {
  private readonly tenantId = 'drdk';
  private readonly defaultParams = {
    device: 'chromecast',
    sub: 'Registered',
    segments: 'drtv',
    lang: 'da',
  };

  private readonly axisDisplayApi = inject(DeltatreAxisDisplayContentFrontendHostApiService);

  async getPage(path: string): Promise<GetPageResult> {
    return firstValueFrom(
      this.axisDisplayApi.getPage(
        this.tenantId,
        path,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        this.defaultParams.device,
        this.defaultParams.sub,
        this.defaultParams.segments,
        this.defaultParams.lang,
        undefined
      )
    );
  }
}
