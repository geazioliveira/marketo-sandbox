export interface UpdateFieldPosition {
  /**
   * Column number of the field
   */
  columnNumber: number;
  /**
   * List of positions inside the fields. Only valid if the target is a fieldset
   */
  fieldList?: Array<UpdateFieldPosition>;
  /**
   * Id of the field
   */
  fieldName: string;
  /**
   * Row number of the field
   */
  rowNumber: number;
}
