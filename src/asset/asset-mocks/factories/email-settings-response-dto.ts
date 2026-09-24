import { faker } from '@faker-js/faker'
import type { EmailSettingsResponseDTO } from '../../asset-definitions/models/email-settings-response-dto'

export function makeEmailSettingsResponseDTO(
  overrides: Partial<EmailSettingsResponseDTO> = {},
): EmailSettingsResponseDTO {
  return {
    isOperational: faker.datatype.boolean(),
    isWebPageView: faker.datatype.boolean(),
    isTextOnly: faker.datatype.boolean(),
    disableOpenTracking: faker.datatype.boolean(),
    enableUrlTracking: faker.datatype.boolean(),
    ...overrides,
  }
}
