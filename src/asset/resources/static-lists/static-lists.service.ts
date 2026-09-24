import { Injectable } from '@nestjs/common'
import { makeResponseOfIdResponse } from '../../asset-mocks/factories/response-of-id-response'
import { makeResponseOfStaticListResponse } from '../../asset-mocks/factories/response-of-static-list-response'

import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfStaticListResponse } from '../../asset-definitions/responses/response-of-static-list-response'

@Injectable()
export class StaticListsService {
  async getStaticListByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfStaticListResponse> {
    return makeResponseOfStaticListResponse()
  }

  async updateStaticListUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfStaticListResponse> {
    return makeResponseOfStaticListResponse()
  }

  async getStaticListsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfStaticListResponse> {
    return makeResponseOfStaticListResponse()
  }

  async createStaticListUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfStaticListResponse> {
    return makeResponseOfStaticListResponse()
  }

  async getStaticListByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfStaticListResponse> {
    return makeResponseOfStaticListResponse()
  }

  async deleteStaticListByIdUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }
}
