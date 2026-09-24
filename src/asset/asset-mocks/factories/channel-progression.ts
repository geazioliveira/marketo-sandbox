import { faker } from '@faker-js/faker'
import type { ChannelProgression } from '../../asset-definitions/models/channel-progression'

export function makeChannelProgression(
  overrides: Partial<ChannelProgression> = {},
): ChannelProgression {
  return {
    description: faker.lorem.sentence(),
    hidden: faker.datatype.boolean(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.lorem.word(),
    step: faker.number.int({ min: 1, max: 1000 }),
    success: true,
    ...overrides,
  }
}
