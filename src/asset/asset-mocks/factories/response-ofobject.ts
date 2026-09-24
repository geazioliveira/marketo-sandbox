import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfobject } from '../../asset-definitions/models/response-ofobject'

export function makeResponseOfobject(
  overrides: Partial<ResponseOfobject> = {},
): ResponseOfobject {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => ({}), { count: { min: 1, max: 3 } }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
