import { faker } from '@faker-js/faker'
import type { Company } from '../../data-ingestion-definitions/models/company'

export function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    externalCompanyId: faker.lorem.word(),
    company: faker.lorem.word(),
    ...overrides,
  }
}
