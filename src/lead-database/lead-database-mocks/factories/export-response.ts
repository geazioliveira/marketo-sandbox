import { faker } from '@faker-js/faker'
import type { ExportResponse } from '../../lead-database-definitions/responses/export-response'

export function makeExportResponse(
  overrides: Partial<ExportResponse> = {},
): ExportResponse {
  return {
    createdAt: faker.date.recent().toISOString(),
    errorMsg: faker.lorem.word(),
    exportId: faker.lorem.word(),
    fileSize: faker.number.int({ min: 1, max: 1000 }),
    fileChecksum: faker.lorem.word(),
    finishedAt: faker.date.recent().toISOString(),
    format: faker.lorem.word(),
    numberOfRecords: faker.number.int({ min: 1, max: 1000 }),
    queuedAt: faker.date.recent().toISOString(),
    startedAt: faker.date.recent().toISOString(),
    status: faker.lorem.word(),
    ...overrides,
  }
}
