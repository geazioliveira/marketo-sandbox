import type { CustomObject } from '../src/data-ingestion/data-ingestion-definitions/models/custom-object'
import type { Person } from '../src/data-ingestion/data-ingestion-definitions/models/person'
import type { LeadAttribute2SearchableFields } from '../src/lead-database/lead-database-definitions/models/lead-attribute2-searchable-fields'
import { makeLeadAttribute2SearchableFields } from '../src/lead-database/lead-database-mocks/factories/lead-attribute2-searchable-fields'

/**
 * A top-level definition without members is a type alias, and the factory of
 * one that is not an object returns the whole value (#24, ADR 0013).
 *
 * The `@ts-expect-error` lines are the guard: `npm run typecheck` fails when
 * one of them stops being an error, as it would if a definition came back as
 * `export interface X {}`, which accepts any value but null and undefined.
 * Neither the e2e tests nor `check:all` would notice that on their own.
 */

describe('definitions without members', () => {
  it('types a top-level array as an array', () => {
    // @ts-expect-error an object is not a LeadAttribute2SearchableFields
    const notAnArray: LeadAttribute2SearchableFields = {}
    const fields: LeadAttribute2SearchableFields = ['email', 'firstName']

    expect([notAnArray, fields]).toHaveLength(2)
  })

  it('types an object with only additionalProperties as a record', () => {
    // @ts-expect-error a number is not a Person
    const notAPerson: Person = 5
    // @ts-expect-error a number is not a CustomObject
    const notACustomObject: CustomObject = 5
    const person: Person = { email: 'lead@example.com' }
    const customObject: CustomObject = { vin: '20UYA31581L000000' }

    expect([notAPerson, notACustomObject, person, customObject]).toHaveLength(4)
  })

  it('makes a top-level array from the faker, or takes the override whole', () => {
    const fields = makeLeadAttribute2SearchableFields()

    expect(Array.isArray(fields)).toBe(true)
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.every((field) => typeof field === 'string')).toBe(true)
    expect(makeLeadAttribute2SearchableFields(['email'])).toEqual(['email'])
  })
})
