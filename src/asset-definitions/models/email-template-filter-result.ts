import type { EmailTemplateContentDTO } from './email-template-content-dto';
import type { PageDetailsDTO } from './page-details-dto';

export interface EmailTemplateFilterResult extends PageDetailsDTO {
  items?: Array<EmailTemplateContentDTO>;
}
