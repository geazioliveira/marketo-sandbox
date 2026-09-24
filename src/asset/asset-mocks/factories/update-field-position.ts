import { faker } from '@faker-js/faker'
import type { UpdateFieldPosition } from '../../asset-definitions/models/update-field-position'

export function makeUpdateFieldPosition(
  overrides: Partial<UpdateFieldPosition> = {},
): UpdateFieldPosition {
  return {
    columnNumber: faker.number.int({ min: 1, max: 1000 }),
    fieldList: [],
    fieldName: faker.lorem.words({ min: 2, max: 3 }),
    rowNumber: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
