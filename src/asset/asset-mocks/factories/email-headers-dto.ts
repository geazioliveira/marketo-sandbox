import { faker } from '@faker-js/faker'
import type { EmailHeadersDTO } from '../../asset-definitions/models/email-headers-dto'

export function makeEmailHeadersDTO(
  overrides: Partial<EmailHeadersDTO> = {},
): EmailHeadersDTO {
  return {
    ccEmails: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    fromEmail: faker.internet.email(),
    fromName: faker.lorem.words({ min: 2, max: 3 }),
    preheader: faker.lorem.words({ min: 2, max: 5 }),
    replyEmail: faker.internet.email(),
    subject: faker.lorem.words({ min: 2, max: 5 }),
    ...overrides,
  }
}
