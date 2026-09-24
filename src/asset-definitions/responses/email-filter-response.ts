import type { EmailFilterResult } from '../models/email-filter-result';

export interface EmailFilterResponse {
  success?: boolean;
  requestId?: string;
  result?: EmailFilterResult;
}
