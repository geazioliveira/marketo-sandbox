import type { CloneNewAsset } from '../models/clone-new-asset'

export interface CloneAssetRequest {
  assetId: string
  newAsset: CloneNewAsset
}
