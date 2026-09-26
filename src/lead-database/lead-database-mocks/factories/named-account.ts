import { faker } from '@faker-js/faker'
import type { NamedAccount } from '../../lead-database-definitions/models/named-account'
import { makeReason } from './reason'

export function makeNamedAccount(
  overrides: Partial<NamedAccount> = {},
): NamedAccount {
  return {
    marketoGUID: faker.lorem.word(),
    reasons: faker.helpers.multiple(() => makeReason(), {
      count: { min: 1, max: 3 },
    }),
    seq: faker.number.int({ min: 1, max: 1000 }),
    status: faker.helpers.arrayElement([
      'created',
      'updated',
      'deleted',
      'skipped',
      'added',
      'removed',
    ] as const),
    ...overrides,
  }
}
