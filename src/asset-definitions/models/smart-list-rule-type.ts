import type { RuleConstraint } from './rule-constraint';

export type SmartListRuleTypeType = "activity" | "attribute";

export interface SmartListRuleType {
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
  type: SmartListRuleTypeType;
  constraints?: Array<RuleConstraint>;
}
