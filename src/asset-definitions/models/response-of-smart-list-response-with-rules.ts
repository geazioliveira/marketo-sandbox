import type { Error } from './error';
import type { SmartListResponseWithRules } from './smart-list-response-with-rules';

export interface ResponseOfSmartListResponseWithRules {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<SmartListResponseWithRules>;
  success?: boolean;
  warnings?: Array<string>;
}
