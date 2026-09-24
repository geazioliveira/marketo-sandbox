import { faker } from '@faker-js/faker'
import type { BrowseAllPrograms } from '../../asset-definitions/models/browse-all-programs'
import { makeFolder } from './folder'

export function makeBrowseAllPrograms(
  overrides: Partial<BrowseAllPrograms> = {},
): BrowseAllPrograms {
  return {
    channel: faker.lorem.word(),
    createdAt: faker.date.recent().toISOString(),
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    sfdcId: faker.lorem.word(),
    sfdcName: faker.lorem.words({ min: 2, max: 3 }),
    status: faker.helpers.arrayElement([
      'locked',
      'unlocked',
      'on',
      'off',
    ] as const),
    type: faker.helpers.arrayElement([
      'program',
      'event',
      'webinar',
      'nurture',
    ] as const),
    updatedAt: faker.date.recent().toISOString(),
    url: faker.internet.url(),
    workspace: 'Default',
    ...overrides,
  }
}
