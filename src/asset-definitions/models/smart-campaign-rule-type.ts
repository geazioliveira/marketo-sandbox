import type { RuleConstraint } from './rule-constraint';

export type SmartCampaignRuleTypeType = "activity" | "attribute";

export interface SmartCampaignRuleType {
  /**
   * Id of the rule type
   */
  id: number;
  /**
   * Name of the rule type
   */
  name: string;
  /**
   * Type of the rule
   */
  type: SmartCampaignRuleTypeType;
  constraints?: Array<RuleConstraint>;
}
