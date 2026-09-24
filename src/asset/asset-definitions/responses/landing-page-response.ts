import type { Folder } from '../models/folder'

export interface LandingPageResponse {
  /**
   * Public URL of the landing page, including the /lp/{munchkinId} path segment
   */
  URL?: string
  /**
   * Url of the asset in the Marketo UI
   */
  computedUrl?: string
  /**
   * Public URL of the landing page, without the /lp/{munchkinId} path segment
   */
  destinationUrl?: string
  /**
   * Datetime the asset was created
   */
  createdAt?: string
  /**
   * Any custom HTML to embed in the <head> tag of the page
   */
  customHeadHTML: string
  /**
   * Description of the asset
   */
  description?: string
  /**
   * Any OpenGraph meta tags to apply to the page
   */
  facebookOgTags: string
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder?: Folder
  /**
   * Boolean to toggle whether forms embedded in the page will prefill. Default false
   */
  formPrefill?: boolean
  /**
   * Id of the asset
   */
  id?: number
  keywords?: string
  /**
   * Whether the page has mobile viewing enabled. Free-form pages only. Default false
   */
  mobileEnabled?: boolean
  /**
   * Name of the asset
   */
  name?: string
  /**
   * Robots directives to apply to the pages meta tags
   */
  robots: string
  /**
   * Status filter for draft or approved versions
   */
  status?: string
  /**
   * Id of the template used
   */
  template?: number
  /**
   * Title element of the landing page
   */
  title: string
  /**
   * Datetime the asset was most recently updated
   */
  updatedAt?: string
  /**
   * Name of the workspace
   */
  workspace?: string
}
