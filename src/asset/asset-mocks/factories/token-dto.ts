import { faker } from '@faker-js/faker'
import type { TokenDTO } from '../../asset-definitions/models/token-dto'

export function makeTokenDTO(overrides: Partial<TokenDTO> = {}): TokenDTO {
  return {
    computedUrl: faker.internet.url(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.lorem.word(),
    value: faker.lorem.word(),
    ...overrides,
  }
}
