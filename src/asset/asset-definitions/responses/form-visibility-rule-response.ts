import type { FormVisibilityRuleDTO } from '../models/form-visibility-rule-dto'

export interface FormVisibilityRuleResponse {
  formFieldId?: string
  ruleType?: string
  rules?: Array<FormVisibilityRuleDTO>
}
