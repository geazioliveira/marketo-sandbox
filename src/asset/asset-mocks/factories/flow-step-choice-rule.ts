import { faker } from '@faker-js/faker'
import type { FlowStepChoiceRule } from '../../asset-definitions/models/flow-step-choice-rule'

export function makeFlowStepChoiceRule(
  overrides: Partial<FlowStepChoiceRule> = {},
): FlowStepChoiceRule {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    operator: faker.lorem.word(),
    ruleType: faker.helpers.arrayElement(['Activity', 'Attribute'] as const),
    ruleTypeId: faker.number.int({ min: 1, max: 99999 }),
    values: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
