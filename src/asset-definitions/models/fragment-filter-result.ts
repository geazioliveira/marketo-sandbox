import type { FragmentContentDTO } from './fragment-content-dto';
import type { PageDetailsDTO } from './page-details-dto';

export interface FragmentFilterResult extends PageDetailsDTO {
  items?: Array<FragmentContentDTO>;
}
