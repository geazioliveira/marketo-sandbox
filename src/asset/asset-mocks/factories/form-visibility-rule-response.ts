import { faker } from '@faker-js/faker'
import type { FormVisibilityRuleResponse } from '../../asset-definitions/responses/form-visibility-rule-response'
import { makeFormVisibilityRuleDTO } from './form-visibility-rule-dto'

export function makeFormVisibilityRuleResponse(
  overrides: Partial<FormVisibilityRuleResponse> = {},
): FormVisibilityRuleResponse {
  return {
    formFieldId: faker.lorem.word(),
    ruleType: faker.lorem.word(),
    rules: faker.helpers.multiple(() => makeFormVisibilityRuleDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
