import type { Error } from '../models/error';
import type { SnippetContentResponse } from './snippet-content-response';

export interface ResponseOfSnippetContentResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<SnippetContentResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
