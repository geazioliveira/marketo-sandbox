import { faker } from '@faker-js/faker'
import type { FragmentSettingsDTO } from '../../asset-definitions/models/fragment-settings-dto'

export function makeFragmentSettingsDTO(
  overrides: Partial<FragmentSettingsDTO> = {},
): FragmentSettingsDTO {
  return {
    fragmentType: faker.lorem.word(),
    fragmentSubType: faker.lorem.word(),
    supportedChannels: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
