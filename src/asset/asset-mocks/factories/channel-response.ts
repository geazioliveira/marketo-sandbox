import { faker } from '@faker-js/faker'
import type { ChannelResponse } from '../../asset-definitions/responses/channel-response'
import { makeChannelProgression } from './channel-progression'

export function makeChannelResponse(
  overrides: Partial<ChannelResponse> = {},
): ChannelResponse {
  return {
    applicableProgramType: faker.lorem.word(),
    createdAt: faker.date.recent().toISOString(),
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    progressionStatuses: faker.helpers.multiple(
      () => makeChannelProgression(),
      { count: { min: 1, max: 3 } },
    ),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  }
}
