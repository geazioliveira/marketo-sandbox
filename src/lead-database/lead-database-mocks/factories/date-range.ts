import { faker } from '@faker-js/faker'
import type { DateRange } from '../../lead-database-definitions/models/date-range'

export function makeDateRange(overrides: Partial<DateRange> = {}): DateRange {
  return {
    endAt: faker.date.recent().toISOString(),
    startAt: faker.date.recent().toISOString(),
    ...overrides,
  }
}
