import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfFolderResponse } from '../../asset-definitions/responses/response-of-folder-response'
import { makeFolderResponse } from './folder-response'

export function makeResponseOfFolderResponse(
  overrides: Partial<ResponseOfFolderResponse> = {},
): ResponseOfFolderResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeFolderResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
