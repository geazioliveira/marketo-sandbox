import { Module } from '@nestjs/common'
import { LandingPageRedirectRulesController } from './landing-page-redirect-rules.controller'
import { LandingPageRedirectRulesService } from './landing-page-redirect-rules.service'

@Module({
  controllers: [LandingPageRedirectRulesController],
  providers: [LandingPageRedirectRulesService],
})
export class LandingPageRedirectRulesModule {}
