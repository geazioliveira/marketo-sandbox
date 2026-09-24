import { faker } from '@faker-js/faker'
import type { UpdateEmailDynamicContentRequest } from '../../asset-definitions/requests/update-email-dynamic-content-request'

export function makeUpdateEmailDynamicContentRequest(
  overrides: Partial<UpdateEmailDynamicContentRequest> = {},
): UpdateEmailDynamicContentRequest {
  return {
    altText: faker.lorem.paragraph(),
    externalUrl: faker.internet.url(),
    height: faker.number.int({ min: 1, max: 1000 }),
    image: faker.lorem.word(),
    linkUrl: faker.internet.url(),
    overWrite: faker.datatype.boolean(),
    style: faker.lorem.word(),
    type: faker.helpers.arrayElement([
      'Text',
      'DynamicContent',
      'Snippet',
    ] as const),
    value: faker.lorem.word(),
    videoUrl: faker.internet.url(),
    width: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
