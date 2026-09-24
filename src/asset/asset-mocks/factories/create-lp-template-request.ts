import { faker } from '@faker-js/faker'
import type { CreateLpTemplateRequest } from '../../asset-definitions/requests/create-lp-template-request'
import { makeFolder } from './folder'

export function makeCreateLpTemplateRequest(
  overrides: Partial<CreateLpTemplateRequest> = {},
): CreateLpTemplateRequest {
  return {
    description: faker.lorem.sentence(),
    enableMunchkin: faker.datatype.boolean(),
    folder: makeFolder(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    templateType: faker.helpers.arrayElement(['guided', 'freeForm'] as const),
    ...overrides,
  }
}
