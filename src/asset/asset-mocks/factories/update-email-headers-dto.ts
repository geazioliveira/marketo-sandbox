import { faker } from '@faker-js/faker'
import type { UpdateEmailHeadersDTO } from '../../asset-definitions/models/update-email-headers-dto'

export function makeUpdateEmailHeadersDTO(
  overrides: Partial<UpdateEmailHeadersDTO> = {},
): UpdateEmailHeadersDTO {
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
