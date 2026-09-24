import { faker } from '@faker-js/faker'
import type { FormFieldVisibilityRequest } from '../../asset-definitions/requests/form-field-visibility-request'
import { makeVisibilityRuleRequest } from './visibility-rule-request'

export function makeFormFieldVisibilityRequest(
  overrides: Partial<FormFieldVisibilityRequest> = {},
): FormFieldVisibilityRequest {
  return {
    ruleType: faker.helpers.arrayElement([
      'show',
      'alwaysShow',
      'hide',
    ] as const),
    rules: faker.helpers.multiple(() => makeVisibilityRuleRequest(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
