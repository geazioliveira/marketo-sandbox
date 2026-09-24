import type { SmartListRuleType } from './smart-list-rule-type';

export interface SmartListRuleTypes {
  /**
   * Filter rule types
   */
  filters?: Array<SmartListRuleType>;
  /**
   * Predictive filter rule types. Present when predictive attributes are available
   */
  predictiveFilters?: Record<string, unknown>;
}
