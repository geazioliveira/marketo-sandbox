import { faker } from '@faker-js/faker'
import type { Company } from '../../lead-database-definitions/models/company'

export function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    externalCompanyId: faker.lorem.word(),
    id: faker.number.int({ min: 1, max: 99999 }),
    company: faker.lorem.word(),
    ...overrides,
  }
}
