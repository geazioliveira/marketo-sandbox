import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfImportLeadResponse } from '../../lead-database-definitions/responses/response-of-import-lead-response'
import { makeImportLeadResponse } from './import-lead-response'

export function makeResponseOfImportLeadResponse(
  overrides: Partial<ResponseOfImportLeadResponse> = {},
): ResponseOfImportLeadResponse {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeImportLeadResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
