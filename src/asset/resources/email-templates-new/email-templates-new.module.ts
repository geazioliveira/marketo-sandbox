import { Module } from '@nestjs/common'
import { EmailTemplatesNewController } from './email-templates-new.controller'
import { EmailTemplatesNewService } from './email-templates-new.service'

@Module({
  controllers: [EmailTemplatesNewController],
  providers: [EmailTemplatesNewService],
})
export class EmailTemplatesNewModule {}
