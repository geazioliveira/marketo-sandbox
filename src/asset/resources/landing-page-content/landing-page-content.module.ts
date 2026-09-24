import { Module } from '@nestjs/common'
import { LandingPageContentController } from './landing-page-content.controller'
import { LandingPageContentService } from './landing-page-content.service'

@Module({
  controllers: [LandingPageContentController],
  providers: [LandingPageContentService],
})
export class LandingPageContentModule {}
