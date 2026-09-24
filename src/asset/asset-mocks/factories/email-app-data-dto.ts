import { faker } from '@faker-js/faker'
import type { EmailAppDataDTO } from '../../asset-definitions/models/email-app-data-dto'

export function makeEmailAppDataDTO(
  overrides: Partial<EmailAppDataDTO> = {},
): EmailAppDataDTO {
  return {
    editorType: faker.lorem.word(),
    folderId: faker.lorem.word(),
    programId: faker.lorem.word(),
    workspaceId: faker.lorem.word(),
    ...overrides,
  }
}
