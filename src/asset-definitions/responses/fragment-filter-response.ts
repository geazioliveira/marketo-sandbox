import type { FragmentFilterResult } from '../models/fragment-filter-result';

export interface FragmentFilterResponse {
  success?: boolean;
  requestId?: string;
  result?: FragmentFilterResult;
}
