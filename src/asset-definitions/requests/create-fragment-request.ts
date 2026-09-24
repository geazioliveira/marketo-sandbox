import type { AppDataDTO } from '../models/app-data-dto';
import type { DataDTO } from '../models/data-dto';
import type { EditorContextDto } from '../models/editor-context-dto';
import type { FragmentSettingsDTO } from '../models/fragment-settings-dto';

export interface CreateFragmentRequest {
  name: string;
  description?: string;
  appData: AppDataDTO;
  data?: DataDTO;
  editorContext?: EditorContextDto;
  settings: FragmentSettingsDTO;
}
