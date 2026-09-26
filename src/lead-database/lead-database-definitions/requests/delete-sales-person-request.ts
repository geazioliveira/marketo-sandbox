import type { SalesPerson } from '../models/sales-person'

export interface DeleteSalesPersonRequest {
  /**
   * Key to use for deletion of the record
   */
  deleteBy?: string
  /**
   * List of input records
   */
  input: Array<SalesPerson>
}
