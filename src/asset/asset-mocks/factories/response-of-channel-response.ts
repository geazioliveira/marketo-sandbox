import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfChannelResponse } from '../../asset-definitions/responses/response-of-channel-response'
import { makeChannelResponse } from './channel-response'

export function makeResponseOfChannelResponse(
  overrides: Partial<ResponseOfChannelResponse> = {},
): ResponseOfChannelResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeChannelResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
