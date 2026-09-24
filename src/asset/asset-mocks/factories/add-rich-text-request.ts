import { faker } from '@faker-js/faker'
import type { AddRichTextRequest } from '../../asset-definitions/requests/add-rich-text-request'

export function makeAddRichTextRequest(
  overrides: Partial<AddRichTextRequest> = {},
): AddRichTextRequest {
  return {
    text: faker.lorem.paragraph(),
    ...overrides,
  }
}
