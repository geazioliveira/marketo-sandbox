import { faker } from '@faker-js/faker'
import type { ThumbnailDTO } from '../../asset-definitions/models/thumbnail-dto'

export function makeThumbnailDTO(
  overrides: Partial<ThumbnailDTO> = {},
): ThumbnailDTO {
  return {
    url: faker.internet.url(),
    ...overrides,
  }
}
