import type { Folder } from '../models/folder'

export interface CreateSmartListRequest {
  /**
   * Name of the smart list. Maximum 255 characters
   */
  name: string
  /**
   * Folder object describing the parent folder
   */
  folder: Folder
  /**
   * Description of the smart list. Maximum 2,000 characters
   */
  description?: string
}
