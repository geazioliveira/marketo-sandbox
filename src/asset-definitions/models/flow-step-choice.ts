import type { FlowStepChoiceAttribute } from './flow-step-choice-attribute';
import type { FlowStepChoiceRule } from './flow-step-choice-rule';

export interface FlowStepChoice {
  /**
   * Id of the choice, used in choice mutation endpoints
   */
  id: number;
  /**
   * Whether this is the default choice for the flow step
   */
  "default": boolean;
  attributes?: Array<FlowStepChoiceAttribute>;
  /**
   * Condition for the choice, present on non-default choices
   */
  rule?: FlowStepChoiceRule;
}
