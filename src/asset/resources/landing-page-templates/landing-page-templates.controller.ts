import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { LandingPageTemplatesService } from './landing-page-templates.service'

import type { CloneLpTemplateRequest } from '../../../asset-definitions/requests/clone-lp-template-request'
import type { CreateLpTemplateRequest } from '../../../asset-definitions/requests/create-lp-template-request'
import type { ResponseOfIdResponse } from '../../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfLpTemplateGetContentResponse } from '../../../asset-definitions/responses/response-of-lp-template-get-content-response'
import type { ResponseOfLpTemplateResponse } from '../../../asset-definitions/responses/response-of-lp-template-response'
import type { UpdateLpTemplateRequest } from '../../../asset-definitions/requests/update-lp-template-request'

@Controller()
export class LandingPageTemplatesController {
  constructor(
    private readonly landingPageTemplatesService: LandingPageTemplatesService,
  ) {}

  @Get('rest/asset/v1/landingPageTemplate/byName.json')
  async getLandingPageTemplateByNameUsingGET(
    @Query('name') name: string,
  ): Promise<ResponseOfLpTemplateResponse> {
    return this.landingPageTemplatesService.getLandingPageTemplateByNameUsingGET(
      name,
    )
  }

  @Get('rest/asset/v1/landingPageTemplate/:id.json')
  async getLandingPageTemplateByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfLpTemplateResponse> {
    return this.landingPageTemplatesService.getLandingPageTemplateByIdUsingGET(
      id,
      status,
    )
  }

  @Post('rest/asset/v1/landingPageTemplate/:id.json')
  async updateLpTemplateUsingPOST(
    @Param('id') id: number,
    @Body() updateLpTemplateRequest: UpdateLpTemplateRequest,
  ): Promise<ResponseOfLpTemplateResponse> {
    return this.landingPageTemplatesService.updateLpTemplateUsingPOST(
      id,
      updateLpTemplateRequest,
    )
  }

  @Post('rest/asset/v1/landingPageTemplate/:id/approveDraft.json')
  async approveLandingPageTemplateUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfLpTemplateResponse> {
    return this.landingPageTemplatesService.approveLandingPageTemplateUsingPOST(
      id,
    )
  }

  @Post('rest/asset/v1/landingPageTemplate/:id/clone.json')
  async cloneLpTemplateUsingPOST(
    @Param('id') id: number,
    @Body() cloneLpTemplateRequest: CloneLpTemplateRequest,
  ): Promise<ResponseOfLpTemplateResponse> {
    return this.landingPageTemplatesService.cloneLpTemplateUsingPOST(
      id,
      cloneLpTemplateRequest,
    )
  }

  @Get('rest/asset/v1/landingPageTemplate/:id/content.json')
  async getLandingPageTemplateContentUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfLpTemplateGetContentResponse> {
    return this.landingPageTemplatesService.getLandingPageTemplateContentUsingGET(
      id,
      status,
    )
  }

  @Post('rest/asset/v1/landingPageTemplate/:id/content.json')
  async updateLandingPageTemplateContentUsingPOST(
    @Param('id') id: number,
    @Body('content') content: string,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPageTemplatesService.updateLandingPageTemplateContentUsingPOST(
      id,
      content,
    )
  }

  @Post('rest/asset/v1/landingPageTemplate/:id/delete.json')
  async deleteLpTemplateUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPageTemplatesService.deleteLpTemplateUsingPOST(id)
  }

  @Post('rest/asset/v1/landingPageTemplate/:id/discardDraft.json')
  async discardDraftUsingPOST_2(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPageTemplatesService.discardDraftUsingPOST_2(id)
  }

  @Post('rest/asset/v1/landingPageTemplate/:id/unapprove.json')
  async unapproveLandingPageTemplateUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfLpTemplateResponse> {
    return this.landingPageTemplatesService.unapproveLandingPageTemplateUsingPOST(
      id,
    )
  }

  @Get('rest/asset/v1/landingPageTemplates.json')
  async getLandingPageTemplatesUsingGET(
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
    @Query('status') status?: 'approved' | 'draft',
    @Query('folder') folder?: string,
  ): Promise<ResponseOfLpTemplateResponse> {
    return this.landingPageTemplatesService.getLandingPageTemplatesUsingGET(
      maxReturn,
      offset,
      status,
      folder,
    )
  }

  @Post('rest/asset/v1/landingPageTemplates.json')
  async createLpTemplateUsingPOST(
    @Body() createLpTemplateRequest: CreateLpTemplateRequest,
  ): Promise<ResponseOfLpTemplateResponse> {
    return this.landingPageTemplatesService.createLpTemplateUsingPOST(
      createLpTemplateRequest,
    )
  }
}
