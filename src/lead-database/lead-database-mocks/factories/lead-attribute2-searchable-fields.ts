import type { LeadAttribute2SearchableFields } from '../../lead-database-definitions/models/lead-attribute2-searchable-fields'

export function makeLeadAttribute2SearchableFields(
  overrides: Partial<LeadAttribute2SearchableFields> = {},
): LeadAttribute2SearchableFields {
  return {
    ...overrides,
  }
}
