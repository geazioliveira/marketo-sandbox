import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfSendSampleResponse } from '../../asset-definitions/responses/response-of-send-sample-response'
import { makeSendSampleResponse } from './send-sample-response'

export function makeResponseOfSendSampleResponse(
  overrides: Partial<ResponseOfSendSampleResponse> = {},
): ResponseOfSendSampleResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSendSampleResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
