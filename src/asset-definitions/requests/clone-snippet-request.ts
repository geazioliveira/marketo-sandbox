import type { Folder } from '../models/folder';

export interface CloneSnippetRequest {
  /**
   * Name for the cloned snippet
   */
  name: string;
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder;
  /**
   * Description of the cloned snippet
   */
  description?: string;
}
