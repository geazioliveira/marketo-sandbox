import { faker } from '@faker-js/faker'
import type { StateTransitionRequest } from '../../asset-definitions/requests/state-transition-request'

export function makeStateTransitionRequest(
  overrides: Partial<StateTransitionRequest> = {},
): StateTransitionRequest {
  return {
    contentId: faker.lorem.paragraph(),
    action: faker.helpers.arrayElement([
      'approve',
      'unapprove',
      'discard',
      'create_draft',
    ] as const),
    ...overrides,
  }
}
