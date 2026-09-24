import { faker } from '@faker-js/faker'
import type { SegmentContent } from '../../asset-definitions/models/segment-content'

export function makeSegmentContent(
  overrides: Partial<SegmentContent> = {},
): SegmentContent {
  return {
    content: {},
    followupType: faker.lorem.word(),
    followupValue: faker.lorem.word(),
    segmentId: faker.number.int({ min: 1, max: 99999 }),
    segmentName: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.lorem.word(),
    ...overrides,
  }
}
