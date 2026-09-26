import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfObjectLinkableObject } from '../../lead-database-definitions/responses/response-of-object-linkable-object'
import { makeObjectLinkableObject } from './object-linkable-object'

export function makeResponseOfObjectLinkableObject(
  overrides: Partial<ResponseOfObjectLinkableObject> = {},
): ResponseOfObjectLinkableObject {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeObjectLinkableObject(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
