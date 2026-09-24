import { faker } from '@faker-js/faker'
import type { FragmentContentDTO } from '../../asset-definitions/models/fragment-content-dto'
import { makeAppDataDTO } from './app-data-dto'
import { makeAssociatedStateDTO } from './associated-state-dto'
import { makeContentMetadataDTO } from './content-metadata-dto'
import { makeEditorContextDto } from './editor-context-dto'
import { makeFragmentSettingsDTO } from './fragment-settings-dto'
import { makeThumbnailDTO } from './thumbnail-dto'

export function makeFragmentContentDTO(
  overrides: Partial<FragmentContentDTO> = {},
): FragmentContentDTO {
  return {
    id: faker.lorem.word(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    appType: faker.lorem.word(),
    metadata: makeContentMetadataDTO(),
    settings: makeFragmentSettingsDTO(),
    thumbnail: makeThumbnailDTO(),
    status: faker.lorem.word(),
    state: faker.lorem.word(),
    virtualId: faker.lorem.word(),
    associatedStates: faker.helpers.multiple(() => makeAssociatedStateDTO(), {
      count: { min: 1, max: 3 },
    }),
    appData: makeAppDataDTO(),
    externalId: faker.lorem.word(),
    editorContext: makeEditorContextDto(),
    scriptEngine: faker.lorem.word(),
    themeId: faker.lorem.word(),
    ...overrides,
  }
}
