export interface SendSampleEmailRequest {
  /**
   * Email address to receive sample email
   */
  emailAddress: string;
  /**
   * Id of a lead to impersonate. Tokens and dynamic content will be populated as though it were sent to the lead.
   */
  leadId?: string;
  /**
   * Whether to send to text only version along with the HTML version. Default false.
   */
  textOnly?: boolean;
}
