export type FlowStepChoiceRuleRuleType = "Activity" | "Attribute";

export interface FlowStepChoiceRule {
  /**
   * Name of the field tested by the condition
   */
  name?: string;
  /**
   * Condition operator, for example 'is', 'is not', 'contains'
   */
  operator?: string;
  /**
   * Type of the condition
   */
  ruleType?: FlowStepChoiceRuleRuleType;
  /**
   * Id of the activity type or field tested by the condition
   */
  ruleTypeId?: number;
  /**
   * Values the condition matches
   */
  values?: Array<string>;
}
