import type { Folder } from '../models/folder'

export interface CreateLandingPageRequest {
  /**
   * Any custom HTML to embed in the <head> tag of the page
   */
  customHeadHTML?: string
  /**
   * Description of the asset
   */
  description?: string
  /**
   * Any OpenGraph meta tags to apply to the page
   */
  facebookOgTags?: string
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder
  keywords?: string
  /**
   * Whether the page has mobile viewing enabled. Free-form pages only. Default false
   */
  mobileEnabled?: boolean
  /**
   * Name of the landing page
   */
  name: string
  /**
   * Boolean to toggle whether forms embedded in the page will prefill. Default false
   */
  prefillForm?: boolean
  /**
   * Robots directives to apply to the pages meta tags
   */
  robots?: string
  /**
   * Id of the template used
   */
  template: number
  /**
   * Title element of the landing page
   */
  title?: string
  /**
   * URL path of the page. Derived from the name field if unset
   */
  urlPageName?: string
  /**
   * Name of the workspace
   */
  workspace?: string
}
