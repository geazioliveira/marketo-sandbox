import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { LandingPageRedirectRulesService } from './landing-page-redirect-rules.service'

import type { CreateLandingPageRedirectRuleRequest } from '../../asset-definitions/requests/create-landing-page-redirect-rule-request'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfLandingPageDomains } from '../../asset-definitions/models/response-of-landing-page-domains'
import type { ResponseOfLandingPageRedirectRules } from '../../asset-definitions/models/response-of-landing-page-redirect-rules'
import type { UpdateLandingPageRedirectRuleRequest } from '../../asset-definitions/requests/update-landing-page-redirect-rule-request'

@Controller()
export class LandingPageRedirectRulesController {
  constructor(
    private readonly landingPageRedirectRulesService: LandingPageRedirectRulesService,
  ) {}

  @Get('rest/asset/v1/redirectRules.json')
  async getLandingPageRedirectRulesUsingGET(
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
    @Query('redirectTolandingPageId') redirectTolandingPageId?: string,
    @Query('redirectToPath') redirectToPath?: string,
    @Query('earliestUpdatedAt') earliestUpdatedAt?: string,
    @Query('latestUpdatedAt') latestUpdatedAt?: string,
  ): Promise<ResponseOfLandingPageRedirectRules> {
    return this.landingPageRedirectRulesService.getLandingPageRedirectRulesUsingGET(
      maxReturn,
      offset,
      redirectTolandingPageId,
      redirectToPath,
      earliestUpdatedAt,
      latestUpdatedAt,
    )
  }

  @Post('rest/asset/v1/redirectRules.json')
  async createLandingPageRedirectRuleUsingPOST(
    @Body()
    createLandingPageRedirectRuleRequest: CreateLandingPageRedirectRuleRequest,
  ): Promise<ResponseOfLandingPageRedirectRules> {
    return this.landingPageRedirectRulesService.createLandingPageRedirectRuleUsingPOST(
      createLandingPageRedirectRuleRequest,
    )
  }

  @Get('rest/asset/v1/redirectRule/:id.json')
  async getLandingPageRedirectRuleByIdUsingGET(
    @Param('id') id: number,
  ): Promise<ResponseOfLandingPageRedirectRules> {
    return this.landingPageRedirectRulesService.getLandingPageRedirectRuleByIdUsingGET(
      id,
    )
  }

  @Post('rest/asset/v1/redirectRule/:id.json')
  async updateLandingPageRedirectRuleUsingPOST(
    @Param('id') id: number,
    @Body()
    updateLandingPageRedirectRuleRequest: UpdateLandingPageRedirectRuleRequest,
  ): Promise<ResponseOfLandingPageRedirectRules> {
    return this.landingPageRedirectRulesService.updateLandingPageRedirectRuleUsingPOST(
      id,
      updateLandingPageRedirectRuleRequest,
    )
  }

  @Post('rest/asset/v1/redirectRule/:id/delete.json')
  async deleteLandingPageRedirectRuleUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.landingPageRedirectRulesService.deleteLandingPageRedirectRuleUsingPOST(
      id,
    )
  }

  @Get('rest/asset/v1/landingPageDomains.json')
  async getLandingPageDomainsUsingGET(
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
  ): Promise<ResponseOfLandingPageDomains> {
    return this.landingPageRedirectRulesService.getLandingPageDomainsUsingGET(
      maxReturn,
      offset,
    )
  }
}
