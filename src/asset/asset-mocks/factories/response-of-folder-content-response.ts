import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfFolderContentResponse } from '../../asset-definitions/responses/response-of-folder-content-response'
import { makeFolderContentResponse } from './folder-content-response'

export function makeResponseOfFolderContentResponse(
  overrides: Partial<ResponseOfFolderContentResponse> = {},
): ResponseOfFolderContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeFolderContentResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
