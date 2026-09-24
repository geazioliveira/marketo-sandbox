import { faker } from '@faker-js/faker'
import type { UpdateEmailComponentContentRequest } from '../../asset-definitions/requests/update-email-component-content-request'

export function makeUpdateEmailComponentContentRequest(
  overrides: Partial<UpdateEmailComponentContentRequest> = {},
): UpdateEmailComponentContentRequest {
  return {
    altText: faker.lorem.paragraph(),
    externalUrl: faker.internet.url(),
    height: faker.number.int({ min: 1, max: 1000 }),
    image: faker.lorem.word(),
    linkUrl: faker.internet.url(),
    overWrite: faker.datatype.boolean(),
    style: faker.lorem.word(),
    textValue: faker.lorem.paragraph(),
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
