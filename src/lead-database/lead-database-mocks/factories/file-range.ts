import { faker } from '@faker-js/faker'
import type { FileRange } from '../../lead-database-definitions/models/file-range'

export function makeFileRange(overrides: Partial<FileRange> = {}): FileRange {
  return {
    end: faker.number.int({ min: 1, max: 1000 }),
    start: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
