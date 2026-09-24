import type { RuleConstraint } from './rule-constraint';

export interface SmartCampaignFlowStepType {
  /**
   * Id of the flow step type
   */
  id: number;
  /**
   * Name of the flow step type
   */
  name: string;
  constraints?: Array<RuleConstraint>;
}
