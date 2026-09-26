import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfAutoSuggestValue } from '../../asset-definitions/responses/response-of-auto-suggest-value'
import { makeAutoSuggestValue } from './auto-suggest-value'

export function makeResponseOfAutoSuggestValue(
  overrides: Partial<ResponseOfAutoSuggestValue> = {},
): ResponseOfAutoSuggestValue {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(
      () =>
        faker.helpers.multiple(() => makeAutoSuggestValue(), {
          count: { min: 1, max: 3 },
        }),
      { count: { min: 1, max: 3 } },
    ),
    success: true,
    warnings: [],
    ...overrides,
  }
}
