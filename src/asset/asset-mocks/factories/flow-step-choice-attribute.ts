import { faker } from '@faker-js/faker'
import type { FlowStepChoiceAttribute } from '../../asset-definitions/models/flow-step-choice-attribute'

export function makeFlowStepChoiceAttribute(
  overrides: Partial<FlowStepChoiceAttribute> = {},
): FlowStepChoiceAttribute {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    activityTypeAttribId: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    dataType: faker.lorem.word(),
    value: faker.lorem.word(),
    format: faker.lorem.word(),
    primary: faker.datatype.boolean(),
    ...overrides,
  }
}
