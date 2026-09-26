import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfImportCustomObjectResponse } from '../../lead-database-definitions/responses/response-of-import-custom-object-response'
import { makeImportCustomObjectResponse } from './import-custom-object-response'

export function makeResponseOfImportCustomObjectResponse(
  overrides: Partial<ResponseOfImportCustomObjectResponse> = {},
): ResponseOfImportCustomObjectResponse {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeImportCustomObjectResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
