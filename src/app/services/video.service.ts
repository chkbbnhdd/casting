import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AccountApiService } from '../../api/video-v1/api/accountApi.service';
import { ContentApiService } from '../../api/video-v1/api/contentApi.service';
import { HealthService } from '../../api/video-v1/api/health.service';
import { AssetMetadata } from '../../api/video-v1/model/assetMetadata';
import { LiveStream } from '../../api/video-v1/model/liveStream';
import { MediaFile } from '../../api/video-v1/model/mediaFile';

@Injectable({ providedIn: 'root' })
export class VideoService {
  private readonly accountApi = inject(AccountApiService);
  private readonly contentApi = inject(ContentApiService);
  private readonly healthApi = inject(HealthService);

  async getAccountItemMediaFiles(
    id: string,
    delivery: Array<string>,
    resolution: string,
    device: string,
    geoLocation: string,
    isLive2Vod?: boolean,
    formats?: Array<string>,
    sub?: string,
    segments?: Array<string>,
    fF?: Array<string>,
    lang?: string,
    apiVersion?: string
  ): Promise<Array<MediaFile>> {
    return firstValueFrom(
      this.accountApi.apiAccountItemsIdVideosGet(
        id,
        delivery,
        resolution,
        device,
        geoLocation,
        isLive2Vod,
        formats,
        sub,
        segments,
        fF,
        lang,
        apiVersion
      )
    );
  }

  async getAssetMetadata(id: string, apiVersion?: string): Promise<AssetMetadata> {
    return firstValueFrom(this.contentApi.apiAssetMetadataIdGet(id, apiVersion));
  }

  async getLiveStreams(
    id: string,
    geoLocation: string,
    device?: string,
    apiVersion?: string
  ): Promise<Array<LiveStream>> {
    return firstValueFrom(this.contentApi.apiChannelsIdLiveStreamsGet(id, geoLocation, device, apiVersion));
  }

  async getPublicItemMediaFiles(
    id: string,
    delivery: Array<string>,
    resolution: string,
    device: string,
    geoLocation: string,
    isLive2Vod?: boolean,
    formats?: Array<string>,
    sub?: string,
    segments?: Array<string>,
    fF?: Array<string>,
    lang?: string,
    apiVersion?: string
  ): Promise<Array<MediaFile>> {
    return firstValueFrom(
      this.contentApi.apiItemsIdVideosGet(
        id,
        delivery,
        resolution,
        device,
        geoLocation,
        isLive2Vod,
        formats,
        sub,
        segments,
        fF,
        lang,
        apiVersion
      )
    );
  }

  async ping(): Promise<{}> {
    return firstValueFrom(this.healthApi.ping());
  }
}
