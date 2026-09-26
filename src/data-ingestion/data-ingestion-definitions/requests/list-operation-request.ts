import type { Lead } from '../models/lead'

export interface ListOperationRequest {
  /**
   * The Marketo static list ID. Must be a positive integer.
   */
  listId: number
  /**
   * List of lead references to add to or remove from the list.
   */
  input: Array<Lead>
}
