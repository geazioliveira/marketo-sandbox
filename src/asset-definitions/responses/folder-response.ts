import type { Folder } from '../models/folder';

export type FolderResponseFolderType = "Email" | "Email Batch Program" | "Email Template" | "Image" | "Landing Page" | "Landing Page Form" | "Landing Page Template" | "Marketing Event" | "Marketing Folder" | "Marketing Program" | "Nurture Program" | "Report" | "Revenue Cycle Model" | "Zone";

export interface FolderResponse {
  accessZoneId?: number;
  /**
   * Datetime the folder was created
   */
  createdAt: string;
  /**
   * Description of the folder
   */
  description?: string;
  /**
   * Id of the folder
   */
  folderId: Folder;
  /**
   * Type of folder
   */
  folderType: FolderResponseFolderType;
  /**
   * Id of the folder
   */
  id: number;
  /**
   * Archival status of the folder
   */
  isArchive: boolean;
  /**
   * Whether the folder is system-managed
   */
  isSystem?: boolean;
  /**
   * Name of the folder. Not applicable for Programs
   */
  name: string;
  /**
   * Parent folder reference
   */
  parent: Folder;
  /**
   * Path of the folder
   */
  path: string;
  /**
   * Datetime the folder was last updated
   */
  updatedAt: string;
  /**
   * Url of the folder
   */
  url: string;
  /**
   * Name of the workspace
   */
  workspace?: string;
}
