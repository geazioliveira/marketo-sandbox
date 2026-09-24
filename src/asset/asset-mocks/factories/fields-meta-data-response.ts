import { faker } from '@faker-js/faker'
import type { FieldsMetaDataResponse } from '../../asset-definitions/responses/fields-meta-data-response'

export function makeFieldsMetaDataResponse(
  overrides: Partial<FieldsMetaDataResponse> = {},
): FieldsMetaDataResponse {
  return {
    dataType: faker.lorem.word(),
    defaultValue: faker.lorem.word(),
    description: faker.lorem.sentence(),
    fieldMaskValues: faker.lorem.word(),
    fieldWidth: faker.number.int({ min: 1, max: 1000 }),
    id: faker.lorem.word(),
    initiallyChecked: faker.datatype.boolean(),
    isLabelToRight: faker.datatype.boolean(),
    isMultiselect: faker.datatype.boolean(),
    isRequired: faker.datatype.boolean(),
    isSensitive: faker.datatype.boolean(),
    labelWidth: faker.number.int({ min: 1, max: 1000 }),
    maxLength: faker.number.int({ min: 1, max: 1000 }),
    maximumNumber: faker.number.float({ min: 0, max: 1000, fractionDigits: 2 }),
    minimumNumber: faker.number.float({ min: 0, max: 1000, fractionDigits: 2 }),
    picklistValues: faker.lorem.word(),
    placeholderText: faker.lorem.paragraph(),
    validationMessage: faker.lorem.sentence(),
    visibleRows: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
