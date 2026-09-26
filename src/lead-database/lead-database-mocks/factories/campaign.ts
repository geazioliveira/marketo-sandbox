import { faker } from '@faker-js/faker'
import type { Campaign } from '../../lead-database-definitions/models/campaign'

export function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    active: faker.datatype.boolean(),
    createdAt: faker.date.recent().toISOString(),
    description: faker.lorem.sentence(),
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    programId: faker.number.int({ min: 1, max: 99999 }),
    programName: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.helpers.arrayElement(['batch', 'trigger'] as const),
    updatedAt: faker.date.recent().toISOString(),
    workspaceName: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
