import type { Folder } from '../models/folder';

export interface GetFilesRequest {
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder?: Folder;
  /**
   * Maximum number of records to return. Max 200, default 20
   */
  maxReturn?: number;
  /**
   * Integer offset for paging
   */
  offset?: number;
}
