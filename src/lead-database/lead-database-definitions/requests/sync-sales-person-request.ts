import type { SalesPerson } from '../models/sales-person'

export type SyncSalesPersonRequestAction =
  'createOnly' | 'updateOnly' | 'createOrUpdate'

export interface SyncSalesPersonRequest {
  /**
   * Type of sync operation to perform
   */
  action?: SyncSalesPersonRequestAction
  /**
   * Field to deduplicate on. If the value in the field for a given record is not unique, an error will be returned for the individual record.
   */
  dedupeBy?: string
  /**
   * List of input records
   */
  input: Array<SalesPerson>
}
