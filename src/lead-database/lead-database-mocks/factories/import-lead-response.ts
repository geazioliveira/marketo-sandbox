import { faker } from '@faker-js/faker'
import type { ImportLeadResponse } from '../../lead-database-definitions/responses/import-lead-response'

export function makeImportLeadResponse(
  overrides: Partial<ImportLeadResponse> = {},
): ImportLeadResponse {
  return {
    batchId: faker.number.int({ min: 1, max: 99999 }),
    importId: faker.lorem.word(),
    message: faker.lorem.sentence(),
    numOfLeadsProcessed: faker.number.int({ min: 1, max: 1000 }),
    numOfRowsFailed: faker.number.int({ min: 1, max: 1000 }),
    numOfRowsWithWarning: faker.number.int({ min: 1, max: 1000 }),
    status: faker.lorem.word(),
    ...overrides,
  }
}
