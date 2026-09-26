import { faker } from '@faker-js/faker'
import type { Lead } from '../../data-ingestion-definitions/models/lead'

export function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    leadId: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
