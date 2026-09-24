export type LandingPageDomainType = "domain" | "domain-alias";

export interface LandingPageDomain {
  /**
   * The hostname for the landing pages
   */
  hostname: string;
  /**
   * Specifies type of hostname
   */
  type: LandingPageDomainType;
}
