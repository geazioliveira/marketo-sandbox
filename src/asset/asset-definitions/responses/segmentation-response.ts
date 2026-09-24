import type { Folder } from '../models/folder'

export interface SegmentationResponse {
  /**
   * Datetime the asset was created
   */
  createdAt?: string
  /**
   * Description of the asset
   */
  description?: string
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder
  /**
   * Id of the asset
   */
  id?: number
  /**
   * Name of the asset
   */
  name?: string
  /**
   * Status filter for draft or approved versions
   */
  status: string
  /**
   * Datetime the asset was most recently updated
   */
  updatedAt?: string
  /**
   * Url of the asset in the Marketo UI
   */
  url?: string
  /**
   * Name of the workspace
   */
  workspace?: string
}
