import { Module } from '@nestjs/common'
import { SmartCampaignsController } from './smart-campaigns.controller'
import { SmartCampaignsService } from './smart-campaigns.service'

@Module({
  controllers: [SmartCampaignsController],
  providers: [SmartCampaignsService],
})
export class SmartCampaignsModule {}
