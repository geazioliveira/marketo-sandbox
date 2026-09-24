import { faker } from '@faker-js/faker'
import type { BulkUsedByItemDTO } from '../../asset-definitions/models/bulk-used-by-item-dto'

export function makeBulkUsedByItemDTO(
  overrides: Partial<BulkUsedByItemDTO> = {},
): BulkUsedByItemDTO {
  return {
    id: faker.lorem.word(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    count: faker.number.int({ min: 1, max: 1000 }),
    used: faker.datatype.boolean(),
    ...overrides,
  }
}
