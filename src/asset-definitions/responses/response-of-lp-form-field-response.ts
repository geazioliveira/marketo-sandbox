import type { Error } from '../models/error';
import type { LpFormFieldResponse } from './lp-form-field-response';

export interface ResponseOfLpFormFieldResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<LpFormFieldResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
