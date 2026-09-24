import { faker } from '@faker-js/faker'
import type { CostRequest } from '../../asset-definitions/requests/cost-request'

export function makeCostRequest(
  overrides: Partial<CostRequest> = {},
): CostRequest {
  return {
    cost: faker.number.int({ min: 1, max: 1000 }),
    note: faker.lorem.word(),
    startDate: faker.date.recent().toISOString(),
    ...overrides,
  }
}
