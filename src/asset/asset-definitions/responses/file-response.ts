import type { FileFolder } from '../models/file-folder'

export interface FileResponse {
  /**
   * Datetime when the file was created
   */
  createdAt: string
  /**
   * Description of the file
   */
  description?: string
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: FileFolder
  /**
   * Id of the file
   */
  id: number
  /**
   * MIME type of the file
   */
  mimeType: string
  /**
   * Name of the file
   */
  name: string
  /**
   * Size of the file in bytes
   */
  size: number
  /**
   * Datetime when the file was most recently updated
   */
  updatedAt: string
  /**
   * Publically accessible URL of the file
   */
  url: string
}
