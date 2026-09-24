import type { EmailHeaderField } from '../models/email-header-field'

export interface UpdateEmailComponentDataRequest {
  /**
   * From-address of the Email
   */
  fromEmail?: EmailHeaderField
  /**
   * From-name of the Email
   */
  fromName?: EmailHeaderField
  /**
   * Reply-To address of the Email
   */
  replyTO?: EmailHeaderField
  /**
   * Subject Line of the Email
   */
  subject?: EmailHeaderField
}
