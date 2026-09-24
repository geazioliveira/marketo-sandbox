import type { Folder } from '../models/folder'

export interface CloneLpTemplateRequest {
  /**
   * Description of the landing page template
   */
  description?: string
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder
  /**
   * Name of the landing page template
   */
  name: string
}
