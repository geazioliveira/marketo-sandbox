import { faker } from '@faker-js/faker'
import type { LookupCustomObjectRequest } from '../../lead-database-definitions/requests/lookup-custom-object-request'
import { makeCustomObject } from './custom-object'

export function makeLookupCustomObjectRequest(
  overrides: Partial<LookupCustomObjectRequest> = {},
): LookupCustomObjectRequest {
  return {
    batchSize: faker.number.int({ min: 1, max: 1000 }),
    fields: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    filterType: faker.lorem.word(),
    input: faker.helpers.multiple(() => makeCustomObject(), {
      count: { min: 1, max: 3 },
    }),
    nextPageToken: faker.lorem.word(),
    ...overrides,
  }
}
