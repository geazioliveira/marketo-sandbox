import type { Folder } from '../models/folder';

export interface CreateFileRequest {
  /**
   * Description of the asset
   */
  description?: string;
  /**
   * Multipart file. Content of the file.
   */
  file: string;
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder;
  /**
   * Whether the calls hould fail if there is already an existing file with the same name
   */
  insertOnly?: boolean;
  /**
   * Name of the File
   */
  name: string;
}
