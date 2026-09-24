import { faker } from '@faker-js/faker'
import type { EmailTemplateContentDTO } from '../../asset-definitions/models/email-template-content-dto'
import { makeAppDataDTO } from './app-data-dto'
import { makeAssociatedStateDTO } from './associated-state-dto'
import { makeContentMetadataDTO } from './content-metadata-dto'

export function makeEmailTemplateContentDTO(
  overrides: Partial<EmailTemplateContentDTO> = {},
): EmailTemplateContentDTO {
  return {
    id: faker.lorem.word(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    appType: faker.lorem.word(),
    metadata: makeContentMetadataDTO(),
    status: faker.lorem.word(),
    state: faker.lorem.word(),
    virtualId: faker.lorem.word(),
    associatedStates: faker.helpers.multiple(() => makeAssociatedStateDTO(), {
      count: { min: 1, max: 3 },
    }),
    version: faker.number.int({ min: 1, max: 1000 }),
    appData: makeAppDataDTO(),
    externalId: faker.lorem.word(),
    scriptEngine: faker.lorem.word(),
    ...overrides,
  }
}
