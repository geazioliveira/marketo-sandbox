import { Injectable } from '@nestjs/common'
import { makeResponseOfEmailTemplateContentResponse } from '../../asset-mocks/factories/response-of-email-template-content-response'
import { makeResponseOfEmailTemplateResponse } from '../../asset-mocks/factories/response-of-email-template-response'
import { makeResponseOfEmailTemplateUsedByResponse } from '../../asset-mocks/factories/response-of-email-template-used-by-response'
import { makeResponseOfIdResponse } from '../../asset-mocks/factories/response-of-id-response'

import type { ResponseOfEmailTemplateContentResponse } from '../../asset-definitions/responses/response-of-email-template-content-response'
import type { ResponseOfEmailTemplateResponse } from '../../asset-definitions/responses/response-of-email-template-response'
import type { ResponseOfEmailTemplateUsedByResponse } from '../../asset-definitions/responses/response-of-email-template-used-by-response'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'

@Injectable()
export class EmailTemplatesService {
  async getTemplateByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfEmailTemplateResponse> {
    return makeResponseOfEmailTemplateResponse()
  }

  async getTemplateByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfEmailTemplateResponse> {
    return makeResponseOfEmailTemplateResponse()
  }

  async updateEmailTemplateUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfEmailTemplateResponse> {
    return makeResponseOfEmailTemplateResponse()
  }

  async approveDraftUsingPOST_1(
    ..._arguments: unknown[]
  ): Promise<ResponseOfEmailTemplateResponse> {
    return makeResponseOfEmailTemplateResponse()
  }

  async cloneTemplateUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfEmailTemplateResponse> {
    return makeResponseOfEmailTemplateResponse()
  }

  async getTemplateContentByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfEmailTemplateContentResponse> {
    return makeResponseOfEmailTemplateContentResponse()
  }

  async updateEmailTemplateContentUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async deleteTemplateUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async discardDraftUsingPOST_1(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async unapproveDraftUsingPOST_1(
    ..._arguments: unknown[]
  ): Promise<ResponseOfEmailTemplateResponse> {
    return makeResponseOfEmailTemplateResponse()
  }

  async getEmailTemplatesUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfEmailTemplateResponse> {
    return makeResponseOfEmailTemplateResponse()
  }

  async createEmailTemplateUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfEmailTemplateResponse> {
    return makeResponseOfEmailTemplateResponse()
  }

  async getEmailTemplateUsedByUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfEmailTemplateUsedByResponse> {
    return makeResponseOfEmailTemplateUsedByResponse()
  }
}
