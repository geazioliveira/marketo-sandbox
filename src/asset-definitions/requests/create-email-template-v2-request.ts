import type { AppDataDTO } from '../models/app-data-dto';
import type { DataDTO } from '../models/data-dto';
import type { EditorContextDto } from '../models/editor-context-dto';

export interface CreateEmailTemplateV2Request {
  name: string;
  description?: string;
  appData: AppDataDTO;
  data?: DataDTO;
  editorContext?: EditorContextDto;
}
