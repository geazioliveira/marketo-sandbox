import type { Folder } from '../models/folder'

export interface CloneProgramRequest {
  description?: string
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder
  /**
   * Name of the program. Max 255 characters
   */
  name: string
}
