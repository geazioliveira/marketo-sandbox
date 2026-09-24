import { faker } from '@faker-js/faker'
import type { UpdateFragmentRequest } from '../../asset-definitions/requests/update-fragment-request'
import { makeDataDTO } from './data-dto'
import { makeEditorContextDto } from './editor-context-dto'
import { makeUpdateFragmentSettingsDTO } from './update-fragment-settings-dto'

export function makeUpdateFragmentRequest(
  overrides: Partial<UpdateFragmentRequest> = {},
): UpdateFragmentRequest {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    data: makeDataDTO(),
    editorContext: makeEditorContextDto(),
    settings: makeUpdateFragmentSettingsDTO(),
    ...overrides,
  }
}
