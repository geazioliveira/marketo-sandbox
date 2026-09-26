import type { Person } from '../../data-ingestion-definitions/models/person'

export function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    ...overrides,
  }
}
