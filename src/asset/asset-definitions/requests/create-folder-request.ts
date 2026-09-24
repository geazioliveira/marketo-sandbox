import type { Folder } from '../models/folder'

export interface CreateFolderRequest {
  /**
   * Description of the asset
   */
  description?: string
  /**
   * Name of the Folder
   */
  name: string
  /**
   * Folder object describing the parent folder
   */
  parent: Folder
}
