import { faker } from '@faker-js/faker'
import type { UsedByRequestDto } from '../../asset-definitions/models/used-by-request-dto'

export function makeUsedByRequestDto(
  overrides: Partial<UsedByRequestDto> = {},
): UsedByRequestDto {
  return {
    assetId: faker.lorem.word(),
    pageIndex: faker.number.int({ min: 1, max: 1000 }),
    pageSize: faker.number.int({ min: 1, max: 1000 }),
    type: faker.lorem.word(),
    ...overrides,
  }
}
