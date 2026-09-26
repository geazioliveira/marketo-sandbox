import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfTagResponse } from '../../asset-definitions/responses/response-of-tag-response'
import { makeTagResponse } from './tag-response'

export function makeResponseOfTagResponse(
  overrides: Partial<ResponseOfTagResponse> = {},
): ResponseOfTagResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeTagResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
