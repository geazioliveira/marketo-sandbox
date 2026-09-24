import { faker } from '@faker-js/faker'
import type { CreateLpFormRequest } from '../../asset-definitions/requests/create-lp-form-request'
import { makeFolder } from './folder'
import { makeFormKnownVisitorDTO } from './form-known-visitor-dto'

export function makeCreateLpFormRequest(
  overrides: Partial<CreateLpFormRequest> = {},
): CreateLpFormRequest {
  return {
    description: faker.lorem.sentence(),
    folder: makeFolder(),
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
