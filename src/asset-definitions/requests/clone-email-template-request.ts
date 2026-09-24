import type { Folder } from '../models/folder';

export interface CloneEmailTemplateRequest {
  /**
   * Description of the asset
   */
  description?: string;
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder;
  /**
   * Name of the Email Template
   */
  name: string;
}
