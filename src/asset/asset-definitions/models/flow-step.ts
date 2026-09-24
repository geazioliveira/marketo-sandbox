import type { FlowStepChoice } from './flow-step-choice'

export interface FlowStep {
  /**
   * Id of the flow step, used in flow step mutation endpoints
   */
  id: number
  /**
   * Id of the flow step action type
   */
  activityTypeId: number
  /**
   * Name of the flow step action type
   */
  activityTypeName: string
  stepChoice?: Array<FlowStepChoice>
}
