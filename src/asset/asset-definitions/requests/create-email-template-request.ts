import type { Folder } from '../models/folder'

export interface CreateEmailTemplateRequest {
  /**
   * Name of the Email Template. Must be unique under the parent folder.
   */
  name: string
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder
  /**
   * Description of the email template
   */
  description?: string
  /**
   * HTML content for template. Multipart file.
   */
  content: string
}
