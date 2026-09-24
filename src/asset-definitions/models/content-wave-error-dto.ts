export interface ContentWaveErrorDTO {
  key?: string;
  message?: string;
  code?: string;
  dynamicMessage?: string;
  /**
   * Severity of the entry: info, warning, or error.
   */
  type?: string;
  /**
   * Origin of the entry, e.g. validation, template, fragment, message_render, asset_publish.
   */
  source?: string;
  errorMessage?: string;
  /**
   * Location in the content the entry refers to (for script/validation errors).
   */
  errorPosition?: { line? : number; column? : number };
}
