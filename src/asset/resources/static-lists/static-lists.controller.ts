import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { StaticListsService } from './static-lists.service'

import type { CreateStaticListRequest } from '../../asset-definitions/requests/create-static-list-request'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfStaticListResponse } from '../../asset-definitions/responses/response-of-static-list-response'
import type { UpdateStaticListRequest } from '../../asset-definitions/requests/update-static-list-request'

@Controller()
export class StaticListsController {
  constructor(private readonly staticListsService: StaticListsService) {}

  @Get('rest/asset/v1/staticList/:id.json')
  async getStaticListByIdUsingGET(
    @Param('id') id: number,
  ): Promise<ResponseOfStaticListResponse> {
    return this.staticListsService.getStaticListByIdUsingGET(id)
  }

  @Post('rest/asset/v1/staticList/:id.json')
  @HttpCode(200)
  async updateStaticListUsingPOST(
    @Param('id') id: number,
    @Body() updateStaticListRequest: UpdateStaticListRequest,
  ): Promise<ResponseOfStaticListResponse> {
    return this.staticListsService.updateStaticListUsingPOST(
      id,
      updateStaticListRequest,
    )
  }

  @Get('rest/asset/v1/staticLists.json')
  async getStaticListsUsingGET(
    @Query('folder') folder?: string,
    @Query('offset') offset?: number,
    @Query('maxReturn') maxReturn?: number,
    @Query('earliestUpdatedAt') earliestUpdatedAt?: string,
    @Query('latestUpdatedAt') latestUpdatedAt?: string,
  ): Promise<ResponseOfStaticListResponse> {
    return this.staticListsService.getStaticListsUsingGET(
      folder,
      offset,
      maxReturn,
      earliestUpdatedAt,
      latestUpdatedAt,
    )
  }

  @Post('rest/asset/v1/staticLists.json')
  @HttpCode(200)
  async createStaticListUsingPOST(
    @Body() createStaticListRequest: CreateStaticListRequest,
  ): Promise<ResponseOfStaticListResponse> {
    return this.staticListsService.createStaticListUsingPOST(
      createStaticListRequest,
    )
  }

  @Get('rest/asset/v1/staticList/byName.json')
  async getStaticListByNameUsingGET(
    @Query('name') name: string,
  ): Promise<ResponseOfStaticListResponse> {
    return this.staticListsService.getStaticListByNameUsingGET(name)
  }

  @Post('rest/asset/v1/staticList/:id/delete.json')
  @HttpCode(200)
  async deleteStaticListByIdUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.staticListsService.deleteStaticListByIdUsingPOST(id)
  }
}
