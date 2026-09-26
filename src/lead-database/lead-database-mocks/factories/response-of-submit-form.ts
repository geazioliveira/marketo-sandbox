import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfSubmitForm } from '../../lead-database-definitions/responses/response-of-submit-form'
import { makeFormResponse } from './form-response'

export function makeResponseOfSubmitForm(
  overrides: Partial<ResponseOfSubmitForm> = {},
): ResponseOfSubmitForm {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeFormResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
