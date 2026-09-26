import { faker } from '@faker-js/faker'
import type { PushLeadToMarketoRequest } from '../../lead-database-definitions/requests/push-lead-to-marketo-request'
import { makePushLead } from './push-lead'

export function makePushLeadToMarketoRequest(
  overrides: Partial<PushLeadToMarketoRequest> = {},
): PushLeadToMarketoRequest {
  return {
    input: faker.helpers.multiple(() => makePushLead(), {
      count: { min: 1, max: 3 },
    }),
    lookupField: faker.lorem.word(),
    partitionName: faker.lorem.words({ min: 2, max: 3 }),
    programName: faker.lorem.words({ min: 2, max: 3 }),
    programStatus: faker.lorem.word(),
    reason: faker.lorem.word(),
    source: faker.lorem.word(),
    ...overrides,
  }
}
