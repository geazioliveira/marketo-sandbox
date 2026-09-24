import { faker } from '@faker-js/faker'
import type { SmartListConditions } from '../../asset-definitions/models/smart-list-conditions'

export function makeSmartListConditions(
  overrides: Partial<SmartListConditions> = {},
): SmartListConditions {
  return {
    activityAttributeId: faker.number.int({ min: 1, max: 99999 }),
    activityAttributeName: faker.lorem.words({ min: 2, max: 3 }),
    attributeId: faker.number.int({ min: 1, max: 99999 }),
    attributeName: faker.lorem.words({ min: 2, max: 3 }),
    operator: faker.lorem.word(),
    values: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    isPrimary: faker.datatype.boolean(),
    isError: faker.datatype.boolean(),
    errorMessage: faker.lorem.sentence(),
    ...overrides,
  }
}
