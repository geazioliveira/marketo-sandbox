import { faker } from '@faker-js/faker'
import type { UpdateEmailMetaDataRequest } from '../../asset-definitions/requests/update-email-meta-data-request'

export function makeUpdateEmailMetaDataRequest(
  overrides: Partial<UpdateEmailMetaDataRequest> = {},
): UpdateEmailMetaDataRequest {
  return {
    description: faker.lorem.sentence(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    preHeader: faker.lorem.words({ min: 2, max: 5 }),
    operational: faker.datatype.boolean(),
    published: faker.datatype.boolean(),
    textOnly: faker.datatype.boolean(),
    webView: faker.datatype.boolean(),
    autoCopyToText: faker.datatype.boolean(),
    ...overrides,
  }
}
