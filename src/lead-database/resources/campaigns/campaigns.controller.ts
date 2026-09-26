import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { CampaignsService } from './campaigns.service'

import type { ResponseOfCampaign } from '../../lead-database-definitions/responses/response-of-campaign'
import type { ScheduleCampaignRequest } from '../../lead-database-definitions/requests/schedule-campaign-request'
import type { TriggerCampaignRequest } from '../../lead-database-definitions/requests/trigger-campaign-request'

@Controller()
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get('rest/v1/campaigns.json')
  async getCampaignsUsingGET(
    @Query('id') id?: Array<number>,
    @Query('name') name?: Array<string>,
    @Query('programName') programName?: Array<string>,
    @Query('workspaceName') workspaceName?: Array<string>,
    @Query('batchSize') batchSize?: number,
    @Query('nextPageToken') nextPageToken?: string,
    @Query('isTriggerable') isTriggerable?: boolean,
  ): Promise<ResponseOfCampaign> {
    return this.campaignsService.getCampaignsUsingGET(
      id,
      name,
      programName,
      workspaceName,
      batchSize,
      nextPageToken,
      isTriggerable,
    )
  }

  @Get('rest/v1/campaigns/:campaignId.json')
  async getCampaignByIdUsingGET(
    @Param('campaignId') campaignId: number,
  ): Promise<ResponseOfCampaign> {
    return this.campaignsService.getCampaignByIdUsingGET(campaignId)
  }

  @Post('rest/v1/campaigns/:campaignId/schedule.json')
  @HttpCode(200)
  async scheduleCampaignUsingPOST(
    @Param('campaignId') campaignId: number,
    @Body() scheduleCampaignRequest?: ScheduleCampaignRequest,
  ): Promise<ResponseOfCampaign> {
    return this.campaignsService.scheduleCampaignUsingPOST(
      campaignId,
      scheduleCampaignRequest,
    )
  }

  @Post('rest/v1/campaigns/:campaignId/trigger.json')
  @HttpCode(200)
  async triggerCampaignUsingPOST(
    @Param('campaignId') campaignId: number,
    @Body() triggerCampaignRequest?: TriggerCampaignRequest,
  ): Promise<ResponseOfCampaign> {
    return this.campaignsService.triggerCampaignUsingPOST(
      campaignId,
      triggerCampaignRequest,
    )
  }
}
