import { faker } from '@faker-js/faker'
import type { SubmitButtonRequest } from '../../asset-definitions/requests/submit-button-request'

export function makeSubmitButtonRequest(
  overrides: Partial<SubmitButtonRequest> = {},
): SubmitButtonRequest {
  return {
    buttonPosition: faker.number.int({ min: 1, max: 1000 }),
    buttonStyle: faker.lorem.word(),
    label: faker.lorem.words({ min: 2, max: 5 }),
    waitingLabel: faker.lorem.words({ min: 2, max: 5 }),
    ...overrides,
  }
}
