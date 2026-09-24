import { faker } from '@faker-js/faker'
import type { PageDetailsDTO } from '../../asset-definitions/models/page-details-dto'

export function makePageDetailsDTO(
  overrides: Partial<PageDetailsDTO> = {},
): PageDetailsDTO {
  return {
    totalItems: faker.number.int({ min: 1, max: 1000 }),
    pageSize: faker.number.int({ min: 1, max: 1000 }),
    currentPage: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
