import type { Folder } from '../models/folder';

export interface CreateStaticListRequest {
  /**
   * Description of the static list
   */
  description?: string;
  /**
   * Name of the static list
   */
  name: string;
  /**
   * Folder object describing the parent folder
   */
  folder: Folder;
}
