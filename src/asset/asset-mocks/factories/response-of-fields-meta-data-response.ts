import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfFieldsMetaDataResponse } from '../../asset-definitions/responses/response-of-fields-meta-data-response'
import { makeFieldsMetaDataResponse } from './fields-meta-data-response'

export function makeResponseOfFieldsMetaDataResponse(
  overrides: Partial<ResponseOfFieldsMetaDataResponse> = {},
): ResponseOfFieldsMetaDataResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeFieldsMetaDataResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
