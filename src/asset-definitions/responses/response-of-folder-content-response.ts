import type { Error } from '../models/error';
import type { FolderContentResponse } from './folder-content-response';

export interface ResponseOfFolderContentResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<FolderContentResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
