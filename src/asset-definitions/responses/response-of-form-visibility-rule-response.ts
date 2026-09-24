import type { Error } from '../models/error';
import type { FormVisibilityRuleResponse } from './form-visibility-rule-response';

export interface ResponseOfFormVisibilityRuleResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<FormVisibilityRuleResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
