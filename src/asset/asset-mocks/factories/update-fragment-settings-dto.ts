import { faker } from '@faker-js/faker'
import type { UpdateFragmentSettingsDTO } from '../../asset-definitions/models/update-fragment-settings-dto'

export function makeUpdateFragmentSettingsDTO(
  overrides: Partial<UpdateFragmentSettingsDTO> = {},
): UpdateFragmentSettingsDTO {
  return {
    fragmentType: faker.lorem.word(),
    fragmentSubType: faker.lorem.word(),
    supportedChannels: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
