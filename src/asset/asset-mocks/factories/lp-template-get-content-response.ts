import { faker } from '@faker-js/faker'
import type { LpTemplateGetContentResponse } from '../../asset-definitions/responses/lp-template-get-content-response'

export function makeLpTemplateGetContentResponse(
  overrides: Partial<LpTemplateGetContentResponse> = {},
): LpTemplateGetContentResponse {
  return {
    content: faker.lorem.paragraph(),
    enableMunchkin: faker.datatype.boolean(),
    id: faker.number.int({ min: 1, max: 99999 }),
    status: faker.helpers.arrayElement(['approved', 'draft'] as const),
    templateType: faker.helpers.arrayElement(['guided', 'freeForm'] as const),
    ...overrides,
  }
}
