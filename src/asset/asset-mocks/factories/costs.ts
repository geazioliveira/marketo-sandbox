import { faker } from '@faker-js/faker'
import type { Costs } from '../../asset-definitions/models/costs'

export function makeCosts(overrides: Partial<Costs> = {}): Costs {
  return {
    cost: faker.number.int({ min: 1, max: 1000 }),
    note: faker.lorem.word(),
    startDate: faker.date.recent().toISOString(),
    ...overrides,
  }
}
