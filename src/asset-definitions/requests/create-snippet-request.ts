import type { Folder } from '../models/folder';

export interface CreateSnippetRequest {
  /**
   * Description of the snippet
   */
  description?: string;
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder;
  /**
   * Name of the snippet
   */
  name: string;
}
