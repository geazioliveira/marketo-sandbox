import type { DataDTO } from './data-dto';
import type { EmailTemplateContentDTO } from './email-template-content-dto';

export interface EmailTemplateDetailDTO extends EmailTemplateContentDTO {
  data?: DataDTO;
}
