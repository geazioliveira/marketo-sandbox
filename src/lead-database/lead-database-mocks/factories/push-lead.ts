import { faker } from '@faker-js/faker'
import type { PushLead } from '../../lead-database-definitions/models/push-lead'
import { makeReason } from './reason'

export function makePushLead(overrides: Partial<PushLead> = {}): PushLead {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    reason: makeReason(),
    status: faker.lorem.word(),
    ...overrides,
  }
}
