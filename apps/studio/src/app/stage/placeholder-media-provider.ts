import { Injectable, inject } from '@angular/core';
import type { SourceAvailability, SourceMediaProvider } from '@studioflow/scene-renderer';
import { StudioApiService } from '../core/api/studio-api.service';
import { ProductionStoreService } from '../core/state/production-store.service';

const PENDING: SourceAvailability = { state: 'pending' };

/**
 * Stand-in source provider while the LiveKit media client is not loaded (yet), failed to load or is unauthorized.
 * Every device source is `pending` (the renderer draws its dark placeholder, monitors still show the scene layout,
 * alerts and «Quelle fehlt»); images and videos load from the API like with the real provider, so media scenes are
 * complete even without LiveKit. `SceneViewComponent` swaps it for `StudioMediaService.provider()` once that exists.
 */
@Injectable({ providedIn: 'root' })
export class PlaceholderMediaProvider implements SourceMediaProvider {
  private readonly store = inject(ProductionStoreService);
  private readonly api = inject(StudioApiService);

  attach(): void {
    // No tracks without LiveKit.
  }

  detach(): void {
    // Nothing was attached.
  }

  availability(): SourceAvailability {
    return PENDING;
  }

  onChange(): () => void {
    return () => undefined;
  }

  setDesiredSize(): void {
    // No layers to select.
  }

  assetUrl(assetId: string): string | null {
    const asset = this.store.assetById(assetId);
    if (asset) {
      return asset.contentUrl;
    }
    const productionId = this.store.productionId();
    return productionId ? this.api.assetContentUrl(productionId, assetId) : null;
  }
}
