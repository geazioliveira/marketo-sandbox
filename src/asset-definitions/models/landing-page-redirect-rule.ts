import type { RedirectFrom } from './redirect-from';
import type { RedirectTo } from './redirect-to';

export interface LandingPageRedirectRule {
  /**
   * Internal id for landing page redirect rule
   */
  id: number;
  /**
   * Redirect 'from' URL of the Landing Page. Combination of the hostname and redirectFrom landing page or path
   */
  redirectFromUrl: string;
  /**
   * Redirect 'to' URL of the Landing Page. Could be a Marketo landing page or non-Marketo URL.
   */
  redirectToUrl: string;
  /**
   * The hostname for the landing pages. Branding domain or alias. Max 255 characters.
   */
  hostname: string;
  /**
   * JSON representation of redirect from landing page, with members 'type' which may be 'landingPageId' or 'path', and 'value'
   */
  redirectFrom: RedirectFrom;
  /**
   * JSON representation of redirect to landing page, with members 'type' which may be 'landingPageId' or 'url', and 'value'
   */
  redirectTo: RedirectTo;
  /**
   * Datetime the landing page redirect rule was created
   */
  createdAt: string;
  /**
   * Datetime the landing page redirect rule was most recently updated
   */
  updatedAt: string;
}
