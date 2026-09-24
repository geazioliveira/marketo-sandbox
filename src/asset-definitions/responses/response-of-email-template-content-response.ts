import type { EmailTemplateContentResponse } from './email-template-content-response';
import type { Error } from '../models/error';

export interface ResponseOfEmailTemplateContentResponse {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<EmailTemplateContentResponse>;
  success?: boolean;
  warnings?: Array<string>;
}
