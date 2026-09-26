import type { Form } from '../models/form'

export interface SubmitFormRequest {
  /**
   * Single array item that contains form fields and visitor data to use during a form submittal
   */
  input: Array<Form>
  /**
   * Id of the form
   */
  formId: number
  /**
   * Id of the program to add lead and/or program member custom fields to
   */
  programId?: number
}
