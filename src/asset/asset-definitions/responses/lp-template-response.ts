import type { Folder } from '../models/folder'

export type LpTemplateResponseTemplateType = 'guided' | 'freeForm'

export interface LpTemplateResponse {
  /**
   * Datetime the asset was created
   */
  createdAt?: string
  /**
   * Description of the asset
   */
  description?: string
  /**
   * Whether to enable munchkin on the derived pages. Defaults to true
   */
  enableMunchkin: boolean
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
   * Type of template to create. Defaults to freeForm
   */
  templateType: LpTemplateResponseTemplateType
  /**
   * Datetime the asset was most recently updated
   */
  updatedAt?: string
  /**
   * Url of the asset in the Marketo UI
   */
  url?: string
  /**
   * Name of the workspace. Max 255 characters
   */
  workspace?: string
}
