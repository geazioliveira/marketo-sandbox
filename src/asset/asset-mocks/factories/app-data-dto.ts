import { faker } from '@faker-js/faker'
import type { AppDataDTO } from '../../asset-definitions/models/app-data-dto'

export function makeAppDataDTO(
  overrides: Partial<AppDataDTO> = {},
): AppDataDTO {
  return {
    editorType: faker.lorem.word(),
    folderId: faker.lorem.word(),
    workspaceId: faker.lorem.word(),
    ...overrides,
  }
}
