import type { Empty } from '../../lead-database-definitions/models/empty'

export function makeEmpty(overrides: Partial<Empty> = {}): Empty {
  return {
    ...overrides,
  }
}
