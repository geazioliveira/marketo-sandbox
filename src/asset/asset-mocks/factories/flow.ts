import { faker } from '@faker-js/faker'
import type { Flow } from '../../asset-definitions/models/flow'
import { makeFlowStep } from './flow-step'

export function makeFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    steps: faker.helpers.multiple(() => makeFlowStep(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
