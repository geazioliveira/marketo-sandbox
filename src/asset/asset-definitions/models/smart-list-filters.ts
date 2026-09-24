import type { SmartListConditions } from './smart-list-conditions'

export type SmartListFiltersRuleType = 'Activity' | 'Attribute'

export interface SmartListFilters {
  /**
   * Id of the filter
   */
  id: number
  /**
   * Name of filter
   */
  name: string
  /**
   * Id of the rule type
   */
  ruleTypeId: number
  /**
   * Type of rule
   */
  ruleType: SmartListFiltersRuleType
  /**
   * Name of operator
   */
  operator: string
  /**
   * List of smart list conditions
   */
  conditions?: Array<SmartListConditions>
}
