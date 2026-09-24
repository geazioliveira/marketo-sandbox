import type { Error } from '../models/error';
import type { TagResponse } from './tag-response';

export interface ResponseOfTagResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<TagResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
