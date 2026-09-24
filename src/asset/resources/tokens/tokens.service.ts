import { Injectable } from '@nestjs/common'
import { makeResponseOfIdResponse } from '../../asset-mocks/factories/response-of-id-response'
import { makeResponseOfTokenResponse } from '../../asset-mocks/factories/response-of-token-response'

import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfTokenResponse } from '../../asset-definitions/responses/response-of-token-response'

@Injectable()
export class TokensService {
  async getTokensByFolderIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfTokenResponse> {
    return makeResponseOfTokenResponse()
  }

  async addTokenTOFolderUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfTokenResponse> {
    return makeResponseOfTokenResponse()
  }

  async deleteTokenByNameUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }
}
