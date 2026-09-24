import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class FormFieldsService {
  async getAllFieldsUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getAllFieldsUsingGET is not implemented.',
    )
  }

  async getAllProgramMemberFieldsUsingGET(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'getAllProgramMemberFieldsUsingGET is not implemented.',
    )
  }

  async addFormFieldVisibilityRuleUsingPOST(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'addFormFieldVisibilityRuleUsingPOST is not implemented.',
    )
  }

  async updateFormFieldUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'updateFormFieldUsingPOST is not implemented.',
    )
  }

  async deleteFormFieldUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'deleteFormFieldUsingPOST is not implemented.',
    )
  }

  async addFieldSetUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'addFieldSetUsingPOST is not implemented.',
    )
  }

  async deleteFormFieldFromFieldSetUsingPOST(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'deleteFormFieldFromFieldSetUsingPOST is not implemented.',
    )
  }

  async getFormFieldByFormVidUsingGET(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'getFormFieldByFormVidUsingGET is not implemented.',
    )
  }

  async addFieldToAFormUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'addFieldToAFormUsingPOST is not implemented.',
    )
  }

  async updateFieldPositionsUsingPOST(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'updateFieldPositionsUsingPOST is not implemented.',
    )
  }

  async addRichTextFieldUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'addRichTextFieldUsingPOST is not implemented.',
    )
  }
}
