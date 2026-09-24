import { Controller, Get, Query } from '@nestjs/common'
import { TagsService } from './tags.service'

import type { ResponseOfTagResponse } from '../../../asset-definitions/responses/response-of-tag-response'
import type { ResponseOfTagResponseGetAll } from '../../../asset-definitions/models/response-of-tag-response-get-all'

@Controller()
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get('rest/asset/v1/tagType/byName.json')
  async getTagByNameUsingGET(
    @Query('name') name: string,
  ): Promise<ResponseOfTagResponse> {
    return this.tagsService.getTagByNameUsingGET(name)
  }

  @Get('rest/asset/v1/tagTypes.json')
  async getTagTypesUsingGET(
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
  ): Promise<ResponseOfTagResponseGetAll> {
    return this.tagsService.getTagTypesUsingGET(maxReturn, offset)
  }
}
