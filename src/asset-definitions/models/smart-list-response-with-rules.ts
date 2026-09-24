import type { Folder } from './folder';
import type { SmartListRules } from './smart-list-rules';

export interface SmartListResponseWithRules {
  /**
   * Id of the smart list
   */
  id: number;
  /**
   * Name of the smart list
   */
  name: string;
  /**
   * Description of the smart list
   */
  description: string;
  /**
   * Datetime the smart list was created
   */
  createdAt: string;
  /**
   * Datetime the smart list was most recently updated
   */
  updatedAt: string;
  /**
   * Url of the smart list in the Marketo UI
   */
  url: string;
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder;
  /**
   * Name of the workspace
   */
  workspace: string;
  /**
   * Rules contained in the smart list
   */
  rules?: SmartListRules;
}
