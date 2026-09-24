import type { Error } from '../models/error';
import type { StaticListResponse } from './static-list-response';

export interface ResponseOfStaticListResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<StaticListResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
