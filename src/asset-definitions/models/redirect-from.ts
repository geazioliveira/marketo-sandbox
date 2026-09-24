export type RedirectFromType = "landingPageId" | "path";

export interface RedirectFrom {
  /**
   * Type of redirect landing page
   */
  type: RedirectFromType;
  /**
   * Value for redirect landing page. If type is 'path' this must not begin with forward slash
   */
  value: string;
}
