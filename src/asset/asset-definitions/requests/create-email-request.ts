import type { Folder } from '../models/folder'

export interface CreateEmailRequest {
  /**
   * Description of the asset
   */
  description?: string
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder
  /**
   * From-address of the Email
   */
  fromEmail: string
  /**
   * From-name of the Email
   */
  fromName: string
  /**
   * Name of the email
   */
  name: string
  /**
   * Whether the email is operational. Operational emails bypass unsubscribe status. Defaults to false
   */
  operational?: boolean
  /**
   * Reply-To address of the Email
   */
  replyEmail: string
  /**
   * Subject Line of the Email
   */
  subject: string
  /**
   * Id of the parent template
   */
  template: number
  /**
   * Setting to include text-only version of email when sent
   */
  textOnly?: boolean
  /**
   * Setting to automatically copy HTML version to Text version
   */
  autoCopyToText?: boolean
}
