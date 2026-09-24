import { faker } from '@faker-js/faker'
import type { Tags } from '../../asset-definitions/models/tags'

export function makeTags(overrides: Partial<Tags> = {}): Tags {
  return {
    tagType: faker.lorem.word(),
    tagValue: faker.lorem.word(),
    ...overrides,
  }
}
