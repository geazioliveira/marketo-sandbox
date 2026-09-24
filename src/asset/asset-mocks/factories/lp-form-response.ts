import { faker } from '@faker-js/faker'
import type { LpFormResponse } from '../../asset-definitions/responses/lp-form-response'
import { makeFolder } from './folder'
import { makeFormKnownVisitorDTO } from './form-known-visitor-dto'
import { makeFormThankYouPageDTO } from './form-thank-you-page-dto'

export function makeLpFormResponse(
  overrides: Partial<LpFormResponse> = {},
): LpFormResponse {
  return {
    buttonLabel: faker.lorem.words({ min: 2, max: 5 }),
    buttonLocation: faker.number.int({ min: 1, max: 1000 }),
    createdAt: faker.date.recent().toISOString(),
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    fontFamily: faker.lorem.word(),
    fontSize: faker.lorem.word(),
    id: faker.number.int({ min: 1, max: 99999 }),
    knownVisitor: makeFormKnownVisitorDTO(),
    labelPosition: faker.lorem.words({ min: 2, max: 5 }),
    language: faker.lorem.word(),
    locale: faker.lorem.word(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    progressiveProfiling: faker.datatype.boolean(),
    status: faker.helpers.arrayElement(['approved', 'draft'] as const),
    thankYouList: faker.helpers.multiple(() => makeFormThankYouPageDTO(), {
      count: { min: 1, max: 3 },
    }),
    theme: faker.lorem.word(),
    updatedAt: faker.date.recent().toISOString(),
    url: faker.internet.url(),
    waitingLabel: faker.lorem.words({ min: 2, max: 5 }),
    ...overrides,
  }
}
