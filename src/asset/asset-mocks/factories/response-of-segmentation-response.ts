import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfSegmentationResponse } from '../../asset-definitions/responses/response-of-segmentation-response'
import { makeSegmentationResponse } from './segmentation-response'

export function makeResponseOfSegmentationResponse(
  overrides: Partial<ResponseOfSegmentationResponse> = {},
): ResponseOfSegmentationResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSegmentationResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
