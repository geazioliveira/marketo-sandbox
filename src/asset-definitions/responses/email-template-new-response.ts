import type { EmailTemplateDetailDTO } from '../models/email-template-detail-dto';

export interface EmailTemplateNewResponse {
  success?: boolean;
  requestId?: string;
  result?: Array<EmailTemplateDetailDTO>;
}
