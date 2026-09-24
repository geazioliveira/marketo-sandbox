import type { DataDTO } from './data-dto';
import type { FragmentContentDTO } from './fragment-content-dto';

export interface FragmentDetailDTO extends FragmentContentDTO {
  data?: DataDTO;
}
