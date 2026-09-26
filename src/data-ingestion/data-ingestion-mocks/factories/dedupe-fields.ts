import { faker } from '@faker-js/faker'
import type { DedupeFields } from '../../data-ingestion-definitions/models/dedupe-fields'

export function makeDedupeFields(
  overrides: Partial<DedupeFields> = {},
): DedupeFields {
  return {
    field1: faker.lorem.word(),
    field2: faker.lorem.word(),
    ...overrides,
  }
}
