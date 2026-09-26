import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfFileResponse } from '../../asset-definitions/responses/response-of-file-response'
import { makeFileResponse } from './file-response'

export function makeResponseOfFileResponse(
  overrides: Partial<ResponseOfFileResponse> = {},
): ResponseOfFileResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeFileResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
