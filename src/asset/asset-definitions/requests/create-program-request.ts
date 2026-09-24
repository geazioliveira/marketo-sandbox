import type { CostRequest } from './cost-request'
import type { Folder } from '../models/folder'
import type { TagRequest } from './tag-request'

export interface CreateProgramRequest {
  /**
   * Channel of the program
   */
  channel: string
  /**
   * Lists of associated period costs
   */
  costs?: Array<CostRequest>
  description?: string
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder
  /**
   * Name of the program
   */
  name: string
  /**
   * List of associated program tags
   */
  tags?: Array<TagRequest>
  /**
   * Type of the program
   */
  type: string
}
