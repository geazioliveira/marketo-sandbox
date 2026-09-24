import { faker } from '@faker-js/faker'
import type { SendSampleResponse } from '../../asset-definitions/responses/send-sample-response'

export function makeSendSampleResponse(
  overrides: Partial<SendSampleResponse> = {},
): SendSampleResponse {
  return {
    service: faker.helpers.arrayElement(['sendTestEmail'] as const),
    result: faker.datatype.boolean(),
    ...overrides,
  }
}
