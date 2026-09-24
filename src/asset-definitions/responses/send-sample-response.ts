export type SendSampleResponseService = "sendTestEmail";

export interface SendSampleResponse {
  /**
   * API call name
   */
  service: SendSampleResponseService;
  /**
   * Whether call was successful
   */
  result: boolean;
}
