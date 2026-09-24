import type { FormVisibilityRuleDTO } from '../models/form-visibility-rule-dto'

export interface FormFieldVisibilityRuleResponse {
  ruleType?: string
  rules?: Array<FormVisibilityRuleDTO>
}
