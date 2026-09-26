import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfExportResponseWithToken } from '../../lead-database-definitions/responses/response-of-export-response-with-token'
import { makeExportResponse } from './export-response'

export function makeResponseOfExportResponseWithToken(
  overrides: Partial<ResponseOfExportResponseWithToken> = {},
): ResponseOfExportResponseWithToken {
  return {
    errors: [],
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeExportResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
