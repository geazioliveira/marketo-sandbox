import { faker } from '@faker-js/faker'
import type { EmailAppDataResponseDTO } from '../../asset-definitions/models/email-app-data-response-dto'

export function makeEmailAppDataResponseDTO(
  overrides: Partial<EmailAppDataResponseDTO> = {},
): EmailAppDataResponseDTO {
  return {
    editorType: faker.lorem.word(),
    workspaceId: faker.lorem.word(),
    folderId: faker.lorem.word(),
    programId: faker.lorem.word(),
    programName: faker.lorem.words({ min: 2, max: 3 }),
    programType: faker.lorem.word(),
    ...overrides,
  }
}
