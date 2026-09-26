import { faker } from '@faker-js/faker'
import type { VisitorData } from '../../lead-database-definitions/models/visitor-data'

export function makeVisitorData(
  overrides: Partial<VisitorData> = {},
): VisitorData {
  return {
    pageURL: faker.internet.url(),
    queryString: faker.lorem.word(),
    leadClientIpAddress: faker.lorem.word(),
    userAgentString: faker.lorem.word(),
    ...overrides,
  }
}
