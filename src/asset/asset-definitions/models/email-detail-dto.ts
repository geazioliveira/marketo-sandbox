import type { DataDTO } from './data-dto'
import type { EmailContentDTO } from './email-content-dto'

export interface EmailDetailDTO extends EmailContentDTO {
  data?: DataDTO
}
