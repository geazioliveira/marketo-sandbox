import type { EmailDetailDTO } from '../models/email-detail-dto';

export interface EmailNewResponse {
  success?: boolean;
  requestId?: string;
  result?: Array<EmailDetailDTO>;
}
