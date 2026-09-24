export type StateTransitionRequestAction = "approve" | "unapprove" | "discard" | "create_draft";

export interface StateTransitionRequest {
  contentId: string;
  /**
   * The state transition action to perform on the asset
   */
  action: StateTransitionRequestAction;
}
