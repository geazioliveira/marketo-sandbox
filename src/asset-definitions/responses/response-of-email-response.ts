import type { EmailResponse } from './email-response';
import type { Error } from '../models/error';

export interface ResponseOfEmailResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<EmailResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
