import { faker } from '@faker-js/faker'
import type { SegmentationResponse } from '../../asset-definitions/responses/segmentation-response'
import { makeFolder } from './folder'

export function makeSegmentationResponse(
  overrides: Partial<SegmentationResponse> = {},
): SegmentationResponse {
  return {
    createdAt: faker.date.recent().toISOString(),
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    status: faker.helpers.arrayElement(['approved', 'draft'] as const),
    updatedAt: faker.date.recent().toISOString(),
    url: faker.internet.url(),
    workspace: 'Default',
    ...overrides,
  }
}
