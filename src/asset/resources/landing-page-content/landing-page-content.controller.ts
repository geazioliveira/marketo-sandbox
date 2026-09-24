import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { LandingPageContentService } from './landing-page-content.service'

import type { CreateLandingPageContentRequest } from '../../asset-definitions/requests/create-landing-page-content-request'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfLandingPageContentResponse } from '../../asset-definitions/responses/response-of-landing-page-content-response'
import type { ResponseOfLandingPageDynamicContentResponse } from '../../asset-definitions/responses/response-of-landing-page-dynamic-content-response'
import type { UpdateLandingPageContentRequest } from '../../asset-definitions/requests/update-landing-page-content-request'
import type { UpdateLandingPageDynamicContentRequest } from '../../asset-definitions/requests/update-landing-page-dynamic-content-request'

@Controller()
export class LandingPageContentController {
  constructor(
    private readonly landingPageContentService: LandingPageContentService,
  ) {}

  @Get('rest/asset/v1/landingPage/:id/content.json')
  async getLandingPageContentUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfLandingPageContentResponse> {
    return this.landingPageContentService.getLandingPageContentUsingGET(
      id,
      status,
    )
  }

  @Post('rest/asset/v1/landingPage/:id/content.json')
  async addLandingPageContentUsingPOST(
    @Param('id') id: number,
    @Body() request: CreateLandingPageContentRequest,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPageContentService.addLandingPageContentUsingPOST(
      id,
      request,
    )
  }

  @Post('rest/asset/v1/landingPage/:id/content/:contentId.json')
  async updateLandingPageContentUsingPOST(
    @Param('id') id: number,
    @Param('contentId') contentId: string,
    @Body() request: UpdateLandingPageContentRequest,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPageContentService.updateLandingPageContentUsingPOST(
      id,
      contentId,
      request,
    )
  }

  @Post('rest/asset/v1/landingPage/:id/content/:contentId/delete.json')
  async removeLandingPageContentUsingPOST(
    @Param('id') id: number,
    @Param('contentId') contentId: string,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPageContentService.removeLandingPageContentUsingPOST(
      id,
      contentId,
    )
  }

  @Get('rest/asset/v1/landingPage/:id/dynamicContent/:contentId.json')
  async getLandingPageDynamicContentsUsingGET(
    @Param('id') id: number,
    @Param('contentId') contentId: string,
  ): Promise<ResponseOfLandingPageDynamicContentResponse> {
    return this.landingPageContentService.getLandingPageDynamicContentsUsingGET(
      id,
      contentId,
    )
  }

  @Post('rest/asset/v1/landingPage/:id/dynamicContent/:contentId.json')
  async updateLandingPageDynamicContentUsingPOST(
    @Param('id') id: number,
    @Param('contentId') contentId: string,
    @Body() request?: UpdateLandingPageDynamicContentRequest,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPageContentService.updateLandingPageDynamicContentUsingPOST(
      id,
      contentId,
      request,
    )
  }
}
