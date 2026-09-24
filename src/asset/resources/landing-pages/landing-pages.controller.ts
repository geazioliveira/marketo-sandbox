import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { LandingPagesService } from './landing-pages.service'

import type { CloneLandingPageRequest } from '../../asset-definitions/requests/clone-landing-page-request'
import type { CreateLandingPageRequest } from '../../asset-definitions/requests/create-landing-page-request'
import type { ResponseOfGetLandingPageFullContentResponse } from '../../asset-definitions/responses/response-of-get-landing-page-full-content-response'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfLandingPageResponse } from '../../asset-definitions/responses/response-of-landing-page-response'
import type { ResponseOfLandingPageVariableResponse } from '../../asset-definitions/responses/response-of-landing-page-variable-response'
import type { UpdateLandingPageRequest } from '../../asset-definitions/requests/update-landing-page-request'

@Controller()
export class LandingPagesController {
  constructor(private readonly landingPagesService: LandingPagesService) {}

  @Get('rest/asset/v1/landingPage/byName.json')
  async getLandingPageByNameUsingGET(
    @Query('name') name: string,
    @Query('status') status?: 'approved' | 'draft',
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
  ): Promise<ResponseOfLandingPageResponse> {
    return this.landingPagesService.getLandingPageByNameUsingGET(
      name,
      status,
      maxReturn,
      offset,
    )
  }

  @Get('rest/asset/v1/landingPage/:id.json')
  async getLandingPageByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfLandingPageResponse> {
    return this.landingPagesService.getLandingPageByIdUsingGET(id, status)
  }

  @Post('rest/asset/v1/landingPage/:id.json')
  async updateLandingPageUsingPOST(
    @Param('id') id: number,
    @Body() updateLandingPageRequest: UpdateLandingPageRequest,
  ): Promise<ResponseOfLandingPageResponse> {
    return this.landingPagesService.updateLandingPageUsingPOST(
      id,
      updateLandingPageRequest,
    )
  }

  @Post('rest/asset/v1/landingPage/:id/approveDraft.json')
  async approveLandingPageUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPagesService.approveLandingPageUsingPOST(id)
  }

  @Post('rest/asset/v1/landingPage/:id/clone.json')
  async cloneLandingPageUsingPOST(
    @Param('id') id: number,
    @Body() cloneLandingPageRequest: CloneLandingPageRequest,
  ): Promise<ResponseOfLandingPageResponse> {
    return this.landingPagesService.cloneLandingPageUsingPOST(
      id,
      cloneLandingPageRequest,
    )
  }

  @Post('rest/asset/v1/landingPage/:id/delete.json')
  async deleteLandingPageByIdUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPagesService.deleteLandingPageByIdUsingPOST(id)
  }

  @Post('rest/asset/v1/landingPage/:id/discardDraft.json')
  async discardLandingPageByIdUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPagesService.discardLandingPageByIdUsingPOST(id)
  }

  @Post('rest/asset/v1/landingPage/:id/unapprove.json')
  async unapproveLandingPageByIdUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfLandingPageResponse> {
    return this.landingPagesService.unapproveLandingPageByIdUsingPOST(id)
  }

  @Post('rest/asset/v1/landingPage/:id/variable/:variableId.json')
  async updateLandingPageVariableUsingPOST(
    @Param('id') id: number,
    @Param('variableId') variableId: string,
    @Query('value') value: number,
  ): Promise<ResponseOfLandingPageVariableResponse> {
    return this.landingPagesService.updateLandingPageVariableUsingPOST(
      id,
      variableId,
      value,
    )
  }

  @Get('rest/asset/v1/landingPage/:id/variables.json')
  async getVariablesUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfLandingPageVariableResponse> {
    return this.landingPagesService.getVariablesUsingGET(id, status)
  }

  @Get('rest/asset/v1/landingPages.json')
  async browseLandingPagesUsingGET(
    @Query('status') status?: 'approved' | 'draft',
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
    @Query('folder') folder?: string,
  ): Promise<ResponseOfLandingPageResponse> {
    return this.landingPagesService.browseLandingPagesUsingGET(
      status,
      maxReturn,
      offset,
      folder,
    )
  }

  @Post('rest/asset/v1/landingPages.json')
  async createLandingPageUsingPOST(
    @Body() createLandingPageRequest: CreateLandingPageRequest,
  ): Promise<ResponseOfLandingPageResponse> {
    return this.landingPagesService.createLandingPageUsingPOST(
      createLandingPageRequest,
    )
  }

  @Get('rest/asset/v1/landingPage/:id/fullContent.json')
  async getLandingPageFullContentUsingGET(
    @Param('id') id: number,
    @Query('leadId') leadId?: number,
    @Query('segmentation') segmentation?: string,
  ): Promise<ResponseOfGetLandingPageFullContentResponse> {
    return this.landingPagesService.getLandingPageFullContentUsingGET(
      id,
      leadId,
      segmentation,
    )
  }
}
