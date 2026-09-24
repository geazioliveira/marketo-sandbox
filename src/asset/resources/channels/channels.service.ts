import { Injectable } from '@nestjs/common'
import { makeResponseOfChannelResponse } from '../../asset-mocks/factories/response-of-channel-response'

import type { ResponseOfChannelResponse } from '../../asset-definitions/responses/response-of-channel-response'

@Injectable()
export class ChannelsService {
  async getChannelByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfChannelResponse> {
    return makeResponseOfChannelResponse()
  }

  async getAllChannelsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfChannelResponse> {
    return makeResponseOfChannelResponse()
  }
}
