import { faker } from '@faker-js/faker'
import type { UpdateFormMetaDataRequest } from '../../asset-definitions/requests/update-form-meta-data-request'
import { makeFormKnownVisitorDTO } from './form-known-visitor-dto'

export function makeUpdateFormMetaDataRequest(
  overrides: Partial<UpdateFormMetaDataRequest> = {},
): UpdateFormMetaDataRequest {
  return {
    customCss: faker.lorem.word(),
    description: faker.lorem.sentence(),
    fontFamily: faker.lorem.word(),
    fontSize: faker.lorem.word(),
    knownVisitor: makeFormKnownVisitorDTO(),
    labelPosition: faker.lorem.words({ min: 2, max: 5 }),
    language: faker.lorem.word(),
    locale: faker.lorem.word(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    progressiveProfiling: faker.datatype.boolean(),
    theme: faker.lorem.word(),
    ...overrides,
  }
}
