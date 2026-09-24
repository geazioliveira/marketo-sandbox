import type { TokenDTO } from '../models/token-dto'

export interface TokenResponse {
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: string
  /**
   * List of tokens in the folder
   */
  tokens?: Array<TokenDTO>
}
