import type { DataDTO } from '../models/data-dto';
import type { EditorContextDto } from '../models/editor-context-dto';
import type { UpdateFragmentSettingsDTO } from '../models/update-fragment-settings-dto';

export interface UpdateFragmentRequest {
  name?: string;
  description?: string;
  data?: DataDTO;
  editorContext?: EditorContextDto;
  settings?: UpdateFragmentSettingsDTO;
}
