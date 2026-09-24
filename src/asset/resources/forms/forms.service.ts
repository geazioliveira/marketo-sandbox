import { Injectable } from '@nestjs/common'
import { makeResponseOfFormUsedByResponse } from '../../asset-mocks/factories/response-of-form-used-by-response'
import { makeResponseOfIdResponse } from '../../asset-mocks/factories/response-of-id-response'
import { makeResponseOfLpFormResponse } from '../../asset-mocks/factories/response-of-lp-form-response'
import { makeResponseOfThankYouPageResponse } from '../../asset-mocks/factories/response-of-thank-you-page-response'

import type { ResponseOfFormUsedByResponse } from '../../asset-definitions/responses/response-of-form-used-by-response'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfLpFormResponse } from '../../asset-definitions/responses/response-of-lp-form-response'
import type { ResponseOfThankYouPageResponse } from '../../asset-definitions/responses/response-of-thank-you-page-response'

@Injectable()
export class FormsService {
  async getLpFormByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormResponse> {
    return makeResponseOfLpFormResponse()
  }

  async getLpFormByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormResponse> {
    return makeResponseOfLpFormResponse()
  }

  async updateFormsUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormResponse> {
    return makeResponseOfLpFormResponse()
  }

  async approveFromUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormResponse> {
    return makeResponseOfLpFormResponse()
  }

  async cloneLpFormsUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormResponse> {
    return makeResponseOfLpFormResponse()
  }

  async deleteFormByIdUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async discardFormByIdUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async updateFormSubmitButtonUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormResponse> {
    return makeResponseOfLpFormResponse()
  }

  async getThankYouPageByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfThankYouPageResponse> {
    return makeResponseOfThankYouPageResponse()
  }

  async updateThankYouPageByIdUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfThankYouPageResponse> {
    return makeResponseOfThankYouPageResponse()
  }

  async browseForms2UsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormResponse> {
    return makeResponseOfLpFormResponse()
  }

  async createLpFormsUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLpFormResponse> {
    return makeResponseOfLpFormResponse()
  }

  async getFormUsedByUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfFormUsedByResponse> {
    return makeResponseOfFormUsedByResponse()
  }
}
