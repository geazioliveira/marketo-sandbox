import { Injectable } from '@nestjs/common'
import { makeResponseOfIdResponse } from '../../asset-mocks/factories/response-of-id-response'
import { makeResponseOfLandingPageDomains } from '../../asset-mocks/factories/response-of-landing-page-domains'
import { makeResponseOfLandingPageRedirectRules } from '../../asset-mocks/factories/response-of-landing-page-redirect-rules'

import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfLandingPageDomains } from '../../asset-definitions/responses/response-of-landing-page-domains'
import type { ResponseOfLandingPageRedirectRules } from '../../asset-definitions/responses/response-of-landing-page-redirect-rules'

@Injectable()
export class LandingPageRedirectRulesService {
  async getLandingPageRedirectRulesUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLandingPageRedirectRules> {
    return makeResponseOfLandingPageRedirectRules()
  }

  async createLandingPageRedirectRuleUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLandingPageRedirectRules> {
    return makeResponseOfLandingPageRedirectRules()
  }

  async getLandingPageRedirectRuleByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLandingPageRedirectRules> {
    return makeResponseOfLandingPageRedirectRules()
  }

  async updateLandingPageRedirectRuleUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLandingPageRedirectRules> {
    return makeResponseOfLandingPageRedirectRules()
  }

  async deleteLandingPageRedirectRuleUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async getLandingPageDomainsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLandingPageDomains> {
    return makeResponseOfLandingPageDomains()
  }
}
