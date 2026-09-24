import type { AppDataDTO } from './app-data-dto';
import type { AssociatedStateDTO } from './associated-state-dto';
import type { ContentMetadataDTO } from './content-metadata-dto';

export interface EmailTemplateContentDTO {
  id?: string;
  name?: string;
  description?: string;
  appType?: string;
  metadata?: ContentMetadataDTO;
  status?: string;
  state?: string;
  virtualId?: string;
  associatedStates?: Array<AssociatedStateDTO>;
  version?: number;
  appData?: AppDataDTO;
  externalId?: string;
  scriptEngine?: string;
}
