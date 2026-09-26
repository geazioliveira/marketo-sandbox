import { faker } from '@faker-js/faker'
import type { InputStreamRangeContent } from '../../lead-database-definitions/models/input-stream-range-content'
import { makeFileRange } from './file-range'
import { makeInputStream } from './input-stream'

export function makeInputStreamRangeContent(
  overrides: Partial<InputStreamRangeContent> = {},
): InputStreamRangeContent {
  return {
    contentType: faker.lorem.paragraph(),
    fileRange: makeFileRange(),
    inputStream: makeInputStream(),
    length: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
