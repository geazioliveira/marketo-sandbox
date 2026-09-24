import type { Error } from '../models/error';
import type { SmartListResponse } from './smart-list-response';

export interface ResponseOfSmartListResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<SmartListResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
