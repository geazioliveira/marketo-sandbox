import { faker } from '@faker-js/faker'
import type { ResponseOfWorkspace } from '../../user-management-definitions/responses/response-of-workspace'

export function makeResponseOfWorkspace(
  overrides: Partial<ResponseOfWorkspace> = {},
): ResponseOfWorkspace {
  return {
    errors: [],
    currencyInfo: faker.lorem.word(),
    description: faker.lorem.sentence(),
    globalViz: faker.number.int({ min: 1, max: 1000 }),
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    createdAt: faker.date.recent().toISOString(),
    updatedAt: faker.date.recent().toISOString(),
    status: faker.lorem.word(),
    ...overrides,
  }
}
