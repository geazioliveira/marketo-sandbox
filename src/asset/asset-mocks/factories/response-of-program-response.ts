import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfProgramResponse } from '../../asset-definitions/responses/response-of-program-response'
import { makeProgramResponse } from './program-response'

export function makeResponseOfProgramResponse(
  overrides: Partial<ResponseOfProgramResponse> = {},
): ResponseOfProgramResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeProgramResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
