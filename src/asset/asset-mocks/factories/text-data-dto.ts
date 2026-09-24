import { faker } from '@faker-js/faker'
import type { TextDataDTO } from '../../asset-definitions/models/text-data-dto'

export function makeTextDataDTO(
  overrides: Partial<TextDataDTO> = {},
): TextDataDTO {
  return {
    body: faker.lorem.paragraph(),
    syncFromHtml: faker.datatype.boolean(),
    ...overrides,
  }
}
