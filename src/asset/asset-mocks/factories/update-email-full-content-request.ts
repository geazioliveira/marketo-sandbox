import { faker } from '@faker-js/faker'
import type { UpdateEmailFullContentRequest } from '../../asset-definitions/requests/update-email-full-content-request'

export function makeUpdateEmailFullContentRequest(
  overrides: Partial<UpdateEmailFullContentRequest> = {},
): UpdateEmailFullContentRequest {
  return {
    content: faker.lorem.paragraph(),
    ...overrides,
  }
}
