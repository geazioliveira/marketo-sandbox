import { faker } from '@faker-js/faker'
import type { FragmentFilterResult } from '../../asset-definitions/models/fragment-filter-result'
import { makeFragmentContentDTO } from './fragment-content-dto'
import { makePageDetailsDTO } from './page-details-dto'

export function makeFragmentFilterResult(
  overrides: Partial<FragmentFilterResult> = {},
): FragmentFilterResult {
  return {
    ...makePageDetailsDTO(),
    items: faker.helpers.multiple(() => makeFragmentContentDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
