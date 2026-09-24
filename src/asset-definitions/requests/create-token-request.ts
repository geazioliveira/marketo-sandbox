export type CreateTokenRequestFolderType = "Program" | "Folder";
export type CreateTokenRequestType = "date" | "number" | "rich text" | "score" | "sfdc campaign" | "text";

export interface CreateTokenRequest {
  /**
   * Type of folder. 'Folder' or 'Program'
   */
  folderType: CreateTokenRequestFolderType;
  /**
   * Name of the token. Max length is 50 characters)
   */
  name: string;
  /**
   * Type of the token
   */
  type: CreateTokenRequestType;
  /**
   * Value of the token
   */
  value: string;
}
