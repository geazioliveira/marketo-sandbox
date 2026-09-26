import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { StaticListsService } from './static-lists.service'

import type { ListOperationRequest } from '../../lead-database-definitions/requests/list-operation-request'
import type { ResponseOfLead } from '../../lead-database-definitions/responses/response-of-lead'
import type { ResponseOfLeadByListId } from '../../lead-database-definitions/responses/response-of-lead-by-list-id'
import type { ResponseOfListOperationOutputData } from '../../lead-database-definitions/responses/response-of-list-operation-output-data'
import type { ResponseOfStaticList } from '../../lead-database-definitions/responses/response-of-static-list'

@Controller()
export class StaticListsController {
  constructor(private readonly staticListsService: StaticListsService) {}

  @Get('rest/v1/list/:listId/leads.json')
  async getLeadsByListIdUsingGET(
    @Param('listId') listId: number,
    @Query('fields') fields?: Array<string>,
    @Query('batchSize') batchSize?: number,
    @Query('nextPageToken') nextPageToken?: string,
  ): Promise<ResponseOfLeadByListId> {
    return this.staticListsService.getLeadsByListIdUsingGET(
      listId,
      fields,
      batchSize,
      nextPageToken,
    )
  }

  @Get('rest/v1/lists.json')
  async getListsUsingGET(
    @Query('id') id?: Array<number>,
    @Query('name') name?: Array<string>,
    @Query('programName') programName?: Array<string>,
    @Query('workspaceName') workspaceName?: Array<string>,
    @Query('batchSize') batchSize?: number,
    @Query('nextPageToken') nextPageToken?: string,
  ): Promise<ResponseOfStaticList> {
    return this.staticListsService.getListsUsingGET(
      id,
      name,
      programName,
      workspaceName,
      batchSize,
      nextPageToken,
    )
  }

  @Get('rest/v1/lists/:listId.json')
  async getListByIdUsingGET(
    @Param('listId') listId: number,
  ): Promise<ResponseOfStaticList> {
    return this.staticListsService.getListByIdUsingGET(listId)
  }

  @Get('rest/v1/lists/:listId/leads.json')
  async getLeadsByListIdUsingGET_1(
    @Param('listId') listId: number,
    @Query('fields') fields?: Array<string>,
    @Query('batchSize') batchSize?: number,
    @Query('nextPageToken') nextPageToken?: string,
  ): Promise<ResponseOfLead> {
    return this.staticListsService.getLeadsByListIdUsingGET_1(
      listId,
      fields,
      batchSize,
      nextPageToken,
    )
  }

  @Post('rest/v1/lists/:listId/leads.json')
  @HttpCode(200)
  async addLeadsToListUsingPOST(
    @Param('listId') listId: number,
    @Body() listOperationRequest?: ListOperationRequest,
    @Query('id') id?: Array<number>,
  ): Promise<ResponseOfListOperationOutputData> {
    return this.staticListsService.addLeadsToListUsingPOST(
      listId,
      listOperationRequest,
      id,
    )
  }

  @Delete('rest/v1/lists/:listId/leads.json')
  async removeLeadsFromListUsingDELETE(
    @Param('listId') listId: number,
    @Body() listOperationRequest: ListOperationRequest,
    @Query('id') id: Array<number>,
  ): Promise<ResponseOfListOperationOutputData> {
    return this.staticListsService.removeLeadsFromListUsingDELETE(
      listId,
      listOperationRequest,
      id,
    )
  }

  @Get('rest/v1/lists/:listId/leads/ismember.json')
  async areLeadsMemberOfListUsingGET(
    @Param('listId') listId: number,
    @Body() listOperationRequest?: ListOperationRequest,
    @Query('id') id?: Array<number>,
  ): Promise<ResponseOfListOperationOutputData> {
    return this.staticListsService.areLeadsMemberOfListUsingGET(
      listId,
      listOperationRequest,
      id,
    )
  }
}
