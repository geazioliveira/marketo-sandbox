export interface UpdateLandingPageRequest {
  /**
   * Any custom HTML to embed in the <head> tag of the page
   */
  customHeadHTML?: string;
  /**
   * Description of the asset
   */
  description?: string;
  /**
   * Any OpenGraph meta tags to apply to the page
   */
  facebookOgTags?: string;
  keywords?: string;
  /**
   * Meta description property of the page
   */
  metaTagsDescription?: string;
  /**
   * Whether the page has mobile viewing enabled. Free-form pages only. Default false
   */
  mobileEnabled?: boolean;
  /**
   * Name of the landing page
   */
  name?: string;
  /**
   * Robots directives to apply to the pages meta tags
   */
  robots?: string;
  /**
   * Additional CSS styles to append to the landing page <head>
   */
  styleOverRide?: string;
  /**
   * Title element of the landing page
   */
  title?: string;
  /**
   * URL path of the page. Derived from the name field if unset
   */
  urlPageName?: string;
}
