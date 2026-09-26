import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfVoid } from '../../lead-database-definitions/responses/response-of-void'

export function makeResponseOfVoid(
  overrides: Partial<ResponseOfVoid> = {},
): ResponseOfVoid {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    success: true,
    warnings: [],
    ...overrides,
  }
}
