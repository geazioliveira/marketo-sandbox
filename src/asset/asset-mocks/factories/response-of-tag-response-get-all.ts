import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfTagResponseGetAll } from '../../asset-definitions/models/response-of-tag-response-get-all'
import { makeTagResponseGetAll } from './tag-response-get-all'

export function makeResponseOfTagResponseGetAll(
  overrides: Partial<ResponseOfTagResponseGetAll> = {},
): ResponseOfTagResponseGetAll {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeTagResponseGetAll(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
