import { faker } from '@faker-js/faker'
import type { CloneNewAsset } from '../../asset-definitions/models/clone-new-asset'

export function makeCloneNewAsset(
  overrides: Partial<CloneNewAsset> = {},
): CloneNewAsset {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    ...overrides,
  }
}
