import type { Error } from './error';
import type { SmartListRuleTypes } from './smart-list-rule-types';

export interface ResponseOfSmartListRuleType {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<SmartListRuleTypes>;
  success?: boolean;
  warnings?: Array<string>;
}
