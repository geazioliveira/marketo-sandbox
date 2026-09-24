import { faker } from '@faker-js/faker'
import type { UpdateLpTemplateRequest } from '../../asset-definitions/requests/update-lp-template-request'

export function makeUpdateLpTemplateRequest(
  overrides: Partial<UpdateLpTemplateRequest> = {},
): UpdateLpTemplateRequest {
  return {
    description: faker.lorem.sentence(),
    enableMunchkin: faker.datatype.boolean(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
