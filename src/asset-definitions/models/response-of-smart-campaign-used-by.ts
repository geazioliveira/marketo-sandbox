import type { Error } from './error';
import type { SmartCampaignUsedBy } from './smart-campaign-used-by';

export interface ResponseOfSmartCampaignUsedBy {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<SmartCampaignUsedBy>;
  success?: boolean;
  warnings?: Array<string>;
}
