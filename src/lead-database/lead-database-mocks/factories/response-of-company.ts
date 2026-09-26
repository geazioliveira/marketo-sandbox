import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfCompany } from '../../lead-database-definitions/responses/response-of-company'
import { makeCompanyResponse } from './company-response'

export function makeResponseOfCompany(
  overrides: Partial<ResponseOfCompany> = {},
): ResponseOfCompany {
  return {
    errors: [],
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeCompanyResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
