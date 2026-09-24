export interface SubmitButtonRequest {
  /**
   * Location in pixels of the button relative to the left of the form
   */
  buttonPosition?: number;
  /**
   * Style of the button
   */
  buttonStyle?: string;
  /**
   * Label text of the button
   */
  label?: string;
  /**
   * Waiting text of the button
   */
  waitingLabel?: string;
}
