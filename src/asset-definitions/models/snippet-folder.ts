export type SnippetFolderType = "Folder" | "Program";

export interface SnippetFolder {
  /**
   * Id of the folder
   */
  value: number;
  /**
   * Type of folder
   */
  type: SnippetFolderType;
  /**
   * Name of folder
   */
  folderName: string;
}
