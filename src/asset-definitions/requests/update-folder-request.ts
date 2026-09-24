export type UpdateFolderRequestType = "Folder" | "Program";

export interface UpdateFolderRequest {
  /**
   * Description of the asset
   */
  description?: string;
  /**
   * Whether the folder is archived or not. Toggling this value will change the archival status of the folder
   */
  isArchive?: boolean;
  /**
   * Name of the Folder
   */
  name?: string;
  /**
   * Type of folder. 'Folder' or 'Program'
   */
  type: UpdateFolderRequestType;
}
