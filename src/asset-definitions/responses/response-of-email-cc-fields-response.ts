import type { EmailCCFields } from '../models/email-cc-fields';
import type { Error } from '../models/error';

export interface ResponseOfEmailCCFieldsResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<EmailCCFields>;
  success?: boolean;
  warnings?: Array<string>;
}
