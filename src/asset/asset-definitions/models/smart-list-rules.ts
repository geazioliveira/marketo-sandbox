import type { SmartListFilters } from './smart-list-filters'

export type SmartListRulesFilterMatchType = 'all' | 'any' | 'custom'

export interface SmartListRules {
  /**
   * Smart list filter match type (rule logic)
   */
  filterMatchType: SmartListRulesFilterMatchType
  /**
   * List of smart list triggers
   */
  triggers: Array<SmartListFilters>
  /**
   * List of smart list filters
   */
  filters: Array<SmartListFilters>
  /**
   * Custom rule logic, for example 1 and (2 or 3). Present when filterMatchType is custom
   */
  filterCustomRuleLogic?: string
}
