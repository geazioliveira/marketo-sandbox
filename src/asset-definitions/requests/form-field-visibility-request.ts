import type { VisibilityRuleRequest } from './visibility-rule-request';

export type FormFieldVisibilityRequestRuleType = "show" | "alwaysShow" | "hide";

export interface FormFieldVisibilityRequest {
  /**
   * Type of rule to apply
   */
  ruleType: FormFieldVisibilityRequestRuleType;
  /**
   * JSON Array of rules
   */
  rules: Array<VisibilityRuleRequest>;
}
