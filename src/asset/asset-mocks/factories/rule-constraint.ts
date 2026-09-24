import { faker } from '@faker-js/faker'
import type { RuleConstraint } from '../../asset-definitions/models/rule-constraint'

export function makeRuleConstraint(
  overrides: Partial<RuleConstraint> = {},
): RuleConstraint {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    dataType: faker.lorem.word(),
    primary: faker.datatype.boolean(),
    operator: faker.lorem.word(),
    dbAttrib: faker.datatype.boolean(),
    dbAttribId: faker.lorem.word(),
    dbObject: faker.lorem.word(),
    type: faker.lorem.word(),
    ...overrides,
  }
}
