export interface FieldsMetaDataResponse {
  /**
   * Type of field
   */
  dataType?: string
  /**
   * Optional default value for the field
   */
  defaultValue?: string
  /**
   * Description of the field
   */
  description?: string
  /**
   * Optional input mask for the field
   */
  fieldMaskValues?: string
  /**
   * Width of the input or select element
   */
  fieldWidth?: number
  /**
   * Id of the field
   */
  id: string
  /**
   * Whether the field should be checked upon loading. Default false
   */
  initiallyChecked?: boolean
  /**
   * Whether the field label should be displayed to the right of the input/select element. Default false
   */
  isLabelToRight?: boolean
  /**
   * Whether the field should allow multiple selections. Default false
   */
  isMultiselect?: boolean
  /**
   * Whether the field is required to submit the form. Default false
   */
  isRequired?: boolean
  /**
   * Whether the field is marked as sensitive. Default false
   */
  isSensitive?: boolean
  /**
   * Width of the field label element
   */
  labelWidth?: number
  /**
   * Maximum length for text type fields
   */
  maxLength?: number
  /**
   * Maximum value accepted by the field
   */
  maximumNumber?: number
  /**
   * Minimum value accepted by the field
   */
  minimumNumber?: number
  /**
   * Comma-separated list of available picklist values for the field
   */
  picklistValues?: string
  /**
   * Placeholder text for the field
   */
  placeholderText?: string
  /**
   * Validation message to display on failed validation
   */
  validationMessage?: string
  /**
   * Number of rows visible for progressive profiling
   */
  visibleRows?: number
}
