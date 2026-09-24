import type { RedirectFrom } from '../models/redirect-from';
import type { RedirectTo } from '../models/redirect-to';

export interface UpdateLandingPageRedirectRuleRequest {
  /**
   * The hostname for the landing pages. Branding domain or alias. Max 255 characters
   */
  hostname?: string;
  /**
   * JSON representation of redirect from landing page, with members 'type' which may be 'landingPageId' or 'path', and 'value'
   */
  redirectFrom?: RedirectFrom;
  /**
   * JSON representation of redirect to landing page, with members 'type' which may be 'landingPageId' or 'url', and 'value'
   */
  redirectTo?: RedirectTo;
}
