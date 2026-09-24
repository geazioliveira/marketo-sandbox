import { faker } from '@faker-js/faker'
import type { FlowStep } from '../../asset-definitions/models/flow-step'
import { makeFlowStepChoice } from './flow-step-choice'

export function makeFlowStep(overrides: Partial<FlowStep> = {}): FlowStep {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    activityTypeId: faker.number.int({ min: 1, max: 99999 }),
    activityTypeName: faker.lorem.words({ min: 2, max: 3 }),
    stepChoice: faker.helpers.multiple(() => makeFlowStepChoice(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
