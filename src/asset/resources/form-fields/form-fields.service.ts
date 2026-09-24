import { Injectable } from '@nestjs/common'
import { makeResponseOfFieldsMetaDataResponse } from '../../asset-mocks/factories/response-of-fields-meta-data-response'
import { makeResponseOfFormVisibilityRuleResponse } from '../../asset-mocks/factories/response-of-form-visibility-rule-response'
import { makeResponseOfIdResponse } from '../../asset-mocks/factories/response-of-id-response'
import { makeResponseOfLpFormFieldResponse } from '../../asset-mocks/factories/response-of-lp-form-field-response'

import type { ResponseOfFieldsMetaDataResponse } from '../../asset-definitions/responses/response-of-fields-meta-data-response'
import type { ResponseOfFormVisibilityRuleResponse } from '../../asset-definitions/responses/response-of-form-visibility-rule-response'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfLpFormFieldResponse } from '../../asset-definitions/responses/response-of-lp-form-field-response'

@Injectable()
export class FormFieldsService {
  async getAllFieldsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfFieldsMetaDataResponse> {
    return makeResponseOfFieldsMetaDataResponse()
  }

  async getAllProgramMemberFieldsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfFieldsMetaDataResponse> {
    return makeResponseOfFieldsMetaDataResponse()
  }

  async addFormFieldVisibilityRuleUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfFormVisibilityRuleResponse> {
    return makeResponseOfFormVisibilityRuleResponse()
  }

  async updateFormFieldUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormFieldResponse> {
    return makeResponseOfLpFormFieldResponse()
  }

  async deleteFormFieldUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async addFieldSetUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormFieldResponse> {
    return makeResponseOfLpFormFieldResponse()
  }

  async deleteFormFieldFromFieldSetUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async getFormFieldByFormVidUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormFieldResponse> {
    return makeResponseOfLpFormFieldResponse()
  }

  async addFieldToAFormUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormFieldResponse> {
    return makeResponseOfLpFormFieldResponse()
  }

  async updateFieldPositionsUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async addRichTextFieldUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormFieldResponse> {
    return makeResponseOfLpFormFieldResponse()
  }
}
