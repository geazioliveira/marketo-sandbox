import type { DedupeFields } from '../models/dedupe-fields'
import type { Person } from '../models/person'

export type SyncPersonsRequestPriority = 'normal' | 'high'

export interface SyncPersonsRequest {
  /**
   * Priority of the request.
   */
  priority?: SyncPersonsRequestPriority
  /**
   * Name of person partition.
   */
  partitionName?: string
  dedupeFields?: DedupeFields
  /**
   * List of attribute name-value pairs for the person.
   */
  persons: Array<Person>
}
