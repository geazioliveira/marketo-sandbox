import type { CostRequest } from './cost-request';
import type { TagRequest } from './tag-request';

export interface UpdateProgramRequest {
  /**
   * Channel of the program. The channel must be valid for the program's type. Updating the channel keeps Program Settings Channel and the Channel tag in sync. If a Channel tag is also passed in tags, the channel value takes precedence. The update is rejected with error code 1173 if a child campaign uses a Change Program Status flow step.
   */
  channel?: string;
  /**
   * Lists of associated period costs that allow you to append, replace, or delete. To append new costs, simply add them to costs array. To replace costs (destructive update), pass new costs and set costsDestructiveUpdate to true. To delete costs, do not pass costs parameter and set costsDestructiveUpdate to true
   */
  costs?: Array<CostRequest>;
  /**
   * Set true to destroy existing costs and replace them with the specified costs
   */
  costsDestructiveUpdate?: boolean;
  /**
   * Updated description for the program
   */
  description?: string;
  /**
   * End date of the program. Applicable to event, email, and webinar type programs
   */
  endDate?: string;
  /**
   * Name of the program
   */
  name?: string;
  /**
   * Start date of program. Applicable to event, email and webinar type programs
   */
  startDate?: string;
  /**
   * List of associated program tags
   */
  tags?: Array<TagRequest>;
}
