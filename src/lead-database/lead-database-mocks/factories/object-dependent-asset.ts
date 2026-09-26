import { faker } from '@faker-js/faker'
import type { ObjectDependentAsset } from '../../lead-database-definitions/models/object-dependent-asset'

export function makeObjectDependentAsset(
  overrides: Partial<ObjectDependentAsset> = {},
): ObjectDependentAsset {
  return {
    assetType: faker.lorem.word(),
    assetId: faker.number.int({ min: 1, max: 99999 }),
    assetName: faker.lorem.words({ min: 2, max: 3 }),
    usedFields: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
