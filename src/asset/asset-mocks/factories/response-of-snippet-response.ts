import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfSnippetResponse } from '../../asset-definitions/responses/response-of-snippet-response'
import { makeSnippetResponse } from './snippet-response'

export function makeResponseOfSnippetResponse(
  overrides: Partial<ResponseOfSnippetResponse> = {},
): ResponseOfSnippetResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSnippetResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
