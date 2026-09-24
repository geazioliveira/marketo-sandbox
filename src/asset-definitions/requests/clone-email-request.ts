import type { Folder } from '../models/folder';

export interface CloneEmailRequest {
  /**
   * Description of the asset
   */
  description?: string;
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder;
  /**
   * Name of the new email asset
   */
  name: string;
  /**
   * Whether the email is operational. Operational emails bypass unsubscribe status. Defaults to false
   */
  operational?: boolean;
}
