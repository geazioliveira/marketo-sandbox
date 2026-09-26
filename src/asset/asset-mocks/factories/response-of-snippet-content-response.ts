import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfSnippetContentResponse } from '../../asset-definitions/responses/response-of-snippet-content-response'
import { makeSnippetContentResponse } from './snippet-content-response'

export function makeResponseOfSnippetContentResponse(
  overrides: Partial<ResponseOfSnippetContentResponse> = {},
): ResponseOfSnippetContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSnippetContentResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
