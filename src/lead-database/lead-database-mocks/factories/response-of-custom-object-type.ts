import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfCustomObjectType } from '../../lead-database-definitions/responses/response-of-custom-object-type'
import { makeEmpty } from './empty'

export function makeResponseOfCustomObjectType(
  overrides: Partial<ResponseOfCustomObjectType> = {},
): ResponseOfCustomObjectType {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmpty(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
