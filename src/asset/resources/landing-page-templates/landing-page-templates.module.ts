import { Module } from '@nestjs/common'
import { LandingPageTemplatesController } from './landing-page-templates.controller'
import { LandingPageTemplatesService } from './landing-page-templates.service'

@Module({
  controllers: [LandingPageTemplatesController],
  providers: [LandingPageTemplatesService],
})
export class LandingPageTemplatesModule {}
