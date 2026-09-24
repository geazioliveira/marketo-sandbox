import type { EmailDynamicContentResponse } from './email-dynamic-content-response';
import type { Error } from '../models/error';

export interface ResponseOfEmailDynamicContentResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<EmailDynamicContentResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
