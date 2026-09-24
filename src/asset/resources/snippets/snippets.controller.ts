import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { SnippetsService } from './snippets.service'

import type { CloneSnippetRequest } from '../../asset-definitions/requests/clone-snippet-request'
import type { CreateSnippetRequest } from '../../asset-definitions/requests/create-snippet-request'
import type { ModelResponse } from '../../asset-definitions/responses/model-response'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfSnippetContentResponse } from '../../asset-definitions/responses/response-of-snippet-content-response'
import type { ResponseOfSnippetResponse } from '../../asset-definitions/responses/response-of-snippet-response'
import type { UpdateSnippetDynamicContentRequest } from '../../asset-definitions/requests/update-snippet-dynamic-content-request'
import type { UpdateSnippetRequest } from '../../asset-definitions/requests/update-snippet-request'

@Controller()
export class SnippetsController {
  constructor(private readonly snippetsService: SnippetsService) {}

  @Get('rest/asset/v1/snippet/:id.json')
  async getSnippetByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfSnippetResponse> {
    return this.snippetsService.getSnippetByIdUsingGET(id, status)
  }

  @Post('rest/asset/v1/snippet/:id.json')
  async updateSnippetUsingPOST(
    @Param('id') id: number,
    @Body() updateSnippetRequest: UpdateSnippetRequest,
  ): Promise<ResponseOfSnippetResponse> {
    return this.snippetsService.updateSnippetUsingPOST(id, updateSnippetRequest)
  }

  @Post('rest/asset/v1/snippet/:id/approveDraft.json')
  async approveSnippetUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfSnippetResponse> {
    return this.snippetsService.approveSnippetUsingPOST(id)
  }

  @Post('rest/asset/v1/snippet/:id/clone.json')
  async cloneSnippetUsingPOST(
    @Param('id') id: number,
    @Body() cloneSnippetRequest?: CloneSnippetRequest,
  ): Promise<ResponseOfSnippetResponse> {
    return this.snippetsService.cloneSnippetUsingPOST(id, cloneSnippetRequest)
  }

  @Get('rest/asset/v1/snippet/:id/content.json')
  async getSnippetContentByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfSnippetContentResponse> {
    return this.snippetsService.getSnippetContentByIdUsingGET(id, status)
  }

  @Post('rest/asset/v1/snippet/:id/content.json')
  async updateContentUsingPOST_1(
    @Param('id') id: number,
    @Query('content') content: string,
    @Query('type') type: 'DynamicContent' | 'HTML' | 'Text',
  ): Promise<ResponseOfIdResponse> {
    return this.snippetsService.updateContentUsingPOST_1(id, content, type)
  }

  @Post('rest/asset/v1/snippet/:id/delete.json')
  async deleteSnippetUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.snippetsService.deleteSnippetUsingPOST(id)
  }

  @Post('rest/asset/v1/snippet/:id/discardDraft.json')
  async discardSnippetUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.snippetsService.discardSnippetUsingPOST(id)
  }

  @Get('rest/asset/v1/snippet/:id/dynamicContent.json')
  async getDynamicContentUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ModelResponse> {
    return this.snippetsService.getDynamicContentUsingGET(id, status)
  }

  @Post('rest/asset/v1/snippet/:id/dynamicContent/:segmentId.json')
  async updateDynamicContentUsingPOST(
    @Param('id') id: number,
    @Param('segmentId') segmentId: number,
    @Body() request: UpdateSnippetDynamicContentRequest,
  ): Promise<ResponseOfIdResponse> {
    return this.snippetsService.updateDynamicContentUsingPOST(
      id,
      segmentId,
      request,
    )
  }

  @Post('rest/asset/v1/snippet/:id/unapprove.json')
  async unapproveSnippetUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfSnippetResponse> {
    return this.snippetsService.unapproveSnippetUsingPOST(id)
  }

  @Get('rest/asset/v1/snippets.json')
  async getSnippetUsingGET(
    @Query('status') status?: 'approved' | 'draft',
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
  ): Promise<ResponseOfSnippetResponse> {
    return this.snippetsService.getSnippetUsingGET(status, maxReturn, offset)
  }

  @Post('rest/asset/v1/snippets.json')
  async createSnippetUsingPOST(
    @Body() createSnippetRequest: CreateSnippetRequest,
  ): Promise<ResponseOfSnippetResponse> {
    return this.snippetsService.createSnippetUsingPOST(createSnippetRequest)
  }
}
