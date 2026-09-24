import { faker } from '@faker-js/faker'
import type { EmailDynamicContentItem } from '../../asset-definitions/models/email-dynamic-content-item'

export function makeEmailDynamicContentItem(
  overrides: Partial<EmailDynamicContentItem> = {},
): EmailDynamicContentItem {
  return {
    content: faker.lorem.paragraph(),
    id: faker.lorem.word(),
    segmentId: faker.lorem.word(),
    segmentName: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.lorem.word(),
    ...overrides,
  }
}
