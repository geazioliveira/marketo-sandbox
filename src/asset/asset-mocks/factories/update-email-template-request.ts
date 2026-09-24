import { faker } from '@faker-js/faker'
import type { UpdateEmailTemplateRequest } from '../../asset-definitions/requests/update-email-template-request'
import { makeDataDTO } from './data-dto'
import { makeEditorContextDto } from './editor-context-dto'

export function makeUpdateEmailTemplateRequest(
  overrides: Partial<UpdateEmailTemplateRequest> = {},
): UpdateEmailTemplateRequest {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    data: makeDataDTO(),
    editorContext: makeEditorContextDto(),
    ...overrides,
  }
}
