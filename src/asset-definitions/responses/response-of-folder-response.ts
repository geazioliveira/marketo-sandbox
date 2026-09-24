import type { Error } from '../models/error';
import type { FolderResponse } from './folder-response';

export interface ResponseOfFolderResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<FolderResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
