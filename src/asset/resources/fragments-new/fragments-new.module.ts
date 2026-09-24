import { Module } from '@nestjs/common'
import { FragmentsNewController } from './fragments-new.controller'
import { FragmentsNewService } from './fragments-new.service'

@Module({
  controllers: [FragmentsNewController],
  providers: [FragmentsNewService],
})
export class FragmentsNewModule {}
