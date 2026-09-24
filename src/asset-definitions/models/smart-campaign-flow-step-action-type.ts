import type { RuleConstraint } from './rule-constraint';

export interface SmartCampaignFlowStepActionType {
  /**
   * Id of the flow step action type
   */
  id: number;
  /**
   * Name of the flow step action type
   */
  name: string;
  constraints?: Array<RuleConstraint>;
}
