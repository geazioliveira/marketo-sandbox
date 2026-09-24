import { Controller, Get, Query } from '@nestjs/common'
import { ChannelsService } from './channels.service'

import type { ResponseOfChannelResponse } from '../../../asset-definitions/responses/response-of-channel-response'

@Controller()
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get('rest/asset/v1/channel/byName.json')
  async getChannelByNameUsingGET(
    @Query('Name') name: string,
  ): Promise<ResponseOfChannelResponse> {
    return this.channelsService.getChannelByNameUsingGET(name)
  }

  @Get('rest/asset/v1/channels.json')
  async getAllChannelsUsingGET(
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
  ): Promise<ResponseOfChannelResponse> {
    return this.channelsService.getAllChannelsUsingGET(maxReturn, offset)
  }
}
