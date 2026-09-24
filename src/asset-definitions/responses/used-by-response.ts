import type { PageDetailsDTO } from '../models/page-details-dto';
import type { UsedByItemDTO } from '../models/used-by-item-dto';

export interface UsedByResponse {
  success?: boolean;
  requestId?: string;
  result?: Array<UsedByItemDTO>;
  pageDetails?: PageDetailsDTO;
}
