import { Injectable } from '@nestjs/common'
import { makeResponseOfCampaign } from '../../lead-database-mocks/factories/response-of-campaign'

import type { ResponseOfCampaign } from '../../lead-database-definitions/responses/response-of-campaign'

@Injectable()
export class CampaignsService {
  async getCampaignsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfCampaign> {
    return makeResponseOfCampaign()
  }

  async getCampaignByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfCampaign> {
    return makeResponseOfCampaign()
  }

  async scheduleCampaignUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfCampaign> {
    return makeResponseOfCampaign()
  }

  async triggerCampaignUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfCampaign> {
    return makeResponseOfCampaign()
  }
}
