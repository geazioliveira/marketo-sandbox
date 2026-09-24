import type { Folder } from '../models/folder';

export interface CloneLandingPageRequest {
  /**
   * Description of the asset
   */
  description?: string;
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder;
  /**
   * Name of the landing page
   */
  name: string;
  /**
   * Id of the template used
   */
  template?: number;
}
