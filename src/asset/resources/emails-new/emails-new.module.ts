import { Module } from '@nestjs/common'
import { EmailsNewController } from './emails-new.controller'
import { EmailsNewService } from './emails-new.service'

@Module({
  controllers: [EmailsNewController],
  providers: [EmailsNewService],
  exports: [EmailsNewService],
})
export class EmailsNewModule {}
