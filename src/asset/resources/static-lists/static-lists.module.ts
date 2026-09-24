import { Module } from '@nestjs/common'
import { StaticListsController } from './static-lists.controller'
import { StaticListsService } from './static-lists.service'

@Module({
  controllers: [StaticListsController],
  providers: [StaticListsService],
})
export class StaticListsModule {}
