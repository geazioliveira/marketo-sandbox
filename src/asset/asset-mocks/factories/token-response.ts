import { faker } from '@faker-js/faker'
import type { TokenResponse } from '../../asset-definitions/responses/token-response'
import { makeTokenDTO } from './token-dto'

export function makeTokenResponse(
  overrides: Partial<TokenResponse> = {},
): TokenResponse {
  return {
    folder: faker.lorem.word(),
    tokens: faker.helpers.multiple(() => makeTokenDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
