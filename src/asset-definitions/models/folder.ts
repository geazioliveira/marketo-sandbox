export type FolderType = "Folder" | "Program";

export interface Folder {
  /**
   * Id of the folder
   */
  id: number;
  /**
   * Type of folder
   */
  type: FolderType;
}
