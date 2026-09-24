export type DeleteTokenRequestFolderType = "Program" | "Folder";

export interface DeleteTokenRequest {
  folderType?: DeleteTokenRequestFolderType;
  name?: string;
  type?: string;
}
