import { faker } from '@faker-js/faker'
import type { SendSampleEmailRequest } from '../../asset-definitions/requests/send-sample-email-request'

export function makeSendSampleEmailRequest(
  overrides: Partial<SendSampleEmailRequest> = {},
): SendSampleEmailRequest {
  return {
    emailAddress: faker.internet.email(),
    leadId: faker.lorem.word(),
    textOnly: faker.datatype.boolean(),
    ...overrides,
  }
}
