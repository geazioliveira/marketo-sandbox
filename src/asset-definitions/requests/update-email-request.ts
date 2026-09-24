import type { DataDTO } from '../models/data-dto';
import type { EditorContextDto } from '../models/editor-context-dto';
import type { EmailSettingsDTO } from '../models/email-settings-dto';
import type { UpdateEmailHeadersDTO } from '../models/update-email-headers-dto';

export interface UpdateEmailRequest {
  name?: string;
  description?: string;
  data?: DataDTO;
  headers?: UpdateEmailHeadersDTO;
  editorContext?: EditorContextDto;
  settings?: EmailSettingsDTO;
  /**
   * When provided, the template's content overwrites both the email's existing content and any data sent in the request.
   */
  templateId?: string;
}
