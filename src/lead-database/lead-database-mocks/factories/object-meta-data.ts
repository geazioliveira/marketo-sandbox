import { faker } from '@faker-js/faker'
import type { ObjectMetaData } from '../../lead-database-definitions/models/object-meta-data'
import { makeObjectField } from './object-field'
import { makeObjectRelation } from './object-relation'

export function makeObjectMetaData(
  overrides: Partial<ObjectMetaData> = {},
): ObjectMetaData {
  return {
    createdAt: faker.date.recent().toISOString(),
    dedupeFields: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    description: faker.lorem.sentence(),
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    pluralName: faker.lorem.words({ min: 2, max: 3 }),
    fields: faker.helpers.multiple(() => makeObjectField(), {
      count: { min: 1, max: 3 },
    }),
    idField: faker.lorem.word(),
    apiName: faker.lorem.words({ min: 2, max: 3 }),
    relationships: faker.helpers.multiple(() => makeObjectRelation(), {
      count: { min: 1, max: 3 },
    }),
    searchableFields: faker.helpers.multiple(
      () =>
        faker.helpers.multiple(() => faker.lorem.word(), {
          count: { min: 1, max: 3 },
        }),
      { count: { min: 1, max: 3 } },
    ),
    updatedAt: faker.date.recent().toISOString(),
    state: faker.helpers.arrayElement([
      'draft',
      'approved',
      'approvedWithDraft',
    ] as const),
    version: faker.helpers.arrayElement(['draft', 'approved'] as const),
    ...overrides,
  }
}
