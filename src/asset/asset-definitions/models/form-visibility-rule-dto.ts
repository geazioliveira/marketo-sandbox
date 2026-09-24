import type { PickListDTO } from './pick-list-dto'

export interface FormVisibilityRuleDTO {
  altLabel?: string
  operator?: string
  picklistFilterValues?: Array<PickListDTO>
  subjectField?: string
  values?: Array<string>
}
