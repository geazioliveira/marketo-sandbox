import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { EmailNewResponse } from '../../asset-definitions/responses/email-new-response'
import { makeEmailDetailDTO } from './email-detail-dto'

export function makeEmailNewResponse(
  overrides: Partial<EmailNewResponse> = {},
): EmailNewResponse {
  return {
    success: true,
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailDetailDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
