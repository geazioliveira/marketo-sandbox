import { faker } from '@faker-js/faker'
import type { InputStreamContent } from '../../lead-database-definitions/models/input-stream-content'
import { makeInputStream } from './input-stream'

export function makeInputStreamContent(
  overrides: Partial<InputStreamContent> = {},
): InputStreamContent {
  return {
    contentType: faker.lorem.paragraph(),
    inputStream: makeInputStream(),
    ...overrides,
  }
}
