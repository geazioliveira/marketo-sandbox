import { faker } from '@faker-js/faker'
import type { CloneAssetRequest } from '../../asset-definitions/requests/clone-asset-request'
import { makeCloneNewAsset } from './clone-new-asset'

export function makeCloneAssetRequest(
  overrides: Partial<CloneAssetRequest> = {},
): CloneAssetRequest {
  return {
    assetId: faker.lorem.word(),
    newAsset: makeCloneNewAsset(),
    ...overrides,
  }
}
