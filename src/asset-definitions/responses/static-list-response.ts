import type { Folder } from '../models/folder';

export interface StaticListResponse {
  /**
   * Id of the static list
   */
  id: number;
  /**
   * Name of the static list
   */
  name: string;
  /**
   * Description of the static list
   */
  description: string;
  /**
   * Datetime the static list was created
   */
  createdAt: string;
  /**
   * Datetime the static list was most recently updated
   */
  updatedAt: string;
  /**
   * May not be present in the response
   */
  url?: string;
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder;
  /**
   * Name of the workspace
   */
  workspace: string;
  /**
   * Url of the asset in the Marketo UI
   */
  computedUrl?: string;
}
