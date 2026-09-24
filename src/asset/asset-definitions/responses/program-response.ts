import type { Costs } from '../models/costs'
import type { Folder } from '../models/folder'
import type { Tags } from '../models/tags'

export type ProgramResponseStatus = 'locked' | 'unlocked' | 'on' | 'off'
export type ProgramResponseType = 'default' | 'event' | 'webinar' | 'nurture'

export interface ProgramResponse {
  /**
   * Channel of the program
   */
  channel: string
  /**
   * Lists of associated period costs
   */
  costs: Array<Costs>
  /**
   * Datetime the asset was created
   */
  createdAt?: string
  /**
   * Description of the asset
   */
  description?: string
  /**
   * End date of the program. Applicable to event, email, and webinar type programs
   */
  endDate?: string
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder
  /**
   * Id of the asset
   */
  id?: number
  /**
   * Name of the asset
   */
  name?: string
  /**
   * SFDC id of the program if linked to an SFDC campaign
   */
  sfdcId?: string
  /**
   * Name of the linked SFDC campaign if applicable
   */
  sfdcName?: string
  /**
   * Start date of program. Applicable to event, email and webinar type programs
   */
  startDate?: string
  /**
   * Status of the program. Only valid for Email and engagement program types.
   */
  status: ProgramResponseStatus
  /**
   * List of associated program tags
   */
  tags: Array<Tags>
  /**
   * Type of the program
   */
  type: ProgramResponseType
  /**
   * Datetime the asset was most recently updated
   */
  updatedAt?: string
  /**
   * Url of the asset in the Marketo UI
   */
  url?: string
  /**
   * Name of the workspace
   */
  workspace?: string
}
