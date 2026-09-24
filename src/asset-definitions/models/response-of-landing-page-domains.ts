import type { Error } from './error';
import type { LandingPageDomain } from './landing-page-domain';

export interface ResponseOfLandingPageDomains {
  errors?: Array<Error>;
  requestId?: string;
  result?: Array<LandingPageDomain>;
  success?: boolean;
  warnings?: Array<string>;
}
