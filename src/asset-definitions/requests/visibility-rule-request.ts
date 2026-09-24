import type { PickListDTO } from '../models/pick-list-dto';

export type VisibilityRuleRequestOperator = "is" | "isNot" | "isEmpty" | "isNotEmpty" | "startsWith" | "notStartsWith" | "endsWith" | "notEndsWith" | "contains" | "notContains" | "greaterThan" | "lessThan" | "atLeast" | "atMost" | "between" | "notBetween" | "notInTimeFrame" | "inPast" | "notInPast" | "after" | "before" | "inTimeFrame" | "onOrAfter" | "onOrBefore";

export interface VisibilityRuleRequest {
  altLabel?: string;
  /**
   * Operation to apply to target field. Evaluated against the list of values when applicable.
   */
  operator: VisibilityRuleRequestOperator;
  /**
   * Alternative label to display when rules are applied.
   */
  pickListValues?: Array<PickListDTO>;
  /**
   * Target field id to apply the operation defined by operator to
   */
  subjectField: string;
  /**
   * Comma-separated list of values to match against. Valid for operators 'is', 'isNot', 'startsWith', 'notStartsWith', 'endsWith', 'notEndsWith', 'contains', and 'notContains'
   */
  values: Array<string>;
}
