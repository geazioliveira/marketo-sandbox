import { faker } from '@faker-js/faker'
import type { FormFieldVisibilityRuleResponse } from '../../asset-definitions/responses/form-field-visibility-rule-response'
import { makeFormVisibilityRuleDTO } from './form-visibility-rule-dto'

export function makeFormFieldVisibilityRuleResponse(
  overrides: Partial<FormFieldVisibilityRuleResponse> = {},
): FormFieldVisibilityRuleResponse {
  return {
    ruleType: faker.lorem.word(),
    rules: faker.helpers.multiple(() => makeFormVisibilityRuleDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
