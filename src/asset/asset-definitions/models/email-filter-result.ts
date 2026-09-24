import type { EmailContentDTO } from './email-content-dto'
import type { PageDetailsDTO } from './page-details-dto'

export interface EmailFilterResult extends PageDetailsDTO {
  items?: Array<EmailContentDTO>
}
