import type { Folder } from '../models/folder';

export interface CloneFormRequest {
  /**
   * Name for the cloned form
   */
  name: string;
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder;
  /**
   * Description of the cloned form
   */
  description?: string;
}
