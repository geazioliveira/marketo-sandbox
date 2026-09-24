export type UpdateEmailComponentContentRequestType =
  'Text' | 'DynamicContent' | 'Snippet'

export interface UpdateEmailComponentContentRequest {
  /**
   * Sets the value of the alt parameter for the resulting img element
   */
  altText?: string
  externalUrl?: string
  /**
   * Overrides naitve height of the image. The resulting file will be resized to the given height
   */
  height?: number
  /**
   * Multipart file that allows you to load an image from your computer
   */
  image?: string
  linkUrl?: string
  /**
   * Allows overwriting of the existing image content section
   */
  overWrite?: boolean
  /**
   * Sets the value of the style parameter for the content section
   */
  style?: string
  textValue?: string
  /**
   * Type of content to set for the section.
   */
  type: UpdateEmailComponentContentRequestType
  /**
   * Value to set for the section. For type Text, the HTML content of the section. For type DynamicContent, the id of the segmentation to use for the content. For type Snippet, the id of the snippet to embed
   */
  value: string
  /**
   * Sets the Url of the video element. Videos must be either from YouTube or Vimeo
   */
  videoUrl?: string
  /**
   * Overrides native width of the image. The resulting file will be resized to the given width
   */
  width?: number
}
