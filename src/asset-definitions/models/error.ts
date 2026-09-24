export interface Error {
  /**
   * Error code of the error. See full list of error codes <a href="https://developers.marketo.com/rest-api/error-codes/">here</a>
   */
  code: string;
  /**
   * Message describing the cause of the error
   */
  message: string;
}
