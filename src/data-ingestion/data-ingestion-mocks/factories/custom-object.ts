import type { CustomObject } from '../../data-ingestion-definitions/models/custom-object'

export function makeCustomObject(
  overrides: Partial<CustomObject> = {},
): CustomObject {
  return {
    ...overrides,
  }
}
