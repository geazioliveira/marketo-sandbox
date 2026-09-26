import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfUpdateEmailFullContentResponse } from '../../asset-definitions/responses/response-of-update-email-full-content-response'
import { makeUpdateEmailFullContentResponse } from './update-email-full-content-response'

export function makeResponseOfUpdateEmailFullContentResponse(
  overrides: Partial<ResponseOfUpdateEmailFullContentResponse> = {},
): ResponseOfUpdateEmailFullContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeUpdateEmailFullContentResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
