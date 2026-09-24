import { faker } from '@faker-js/faker'
import type { HtmlDataDTO } from '../../asset-definitions/models/html-data-dto'

export function makeHtmlDataDTO(
  overrides: Partial<HtmlDataDTO> = {},
): HtmlDataDTO {
  return {
    body: faker.lorem.paragraph(),
    ...overrides,
  }
}
