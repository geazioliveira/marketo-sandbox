import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfBrowseAllPrograms } from '../../asset-definitions/responses/response-of-browse-all-programs'
import { makeBrowseAllPrograms } from './browse-all-programs'

export function makeResponseOfBrowseAllPrograms(
  overrides: Partial<ResponseOfBrowseAllPrograms> = {},
): ResponseOfBrowseAllPrograms {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeBrowseAllPrograms(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
