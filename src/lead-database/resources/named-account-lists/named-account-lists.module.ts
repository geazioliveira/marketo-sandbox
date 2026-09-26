import { Module } from '@nestjs/common'
import { NamedAccountListsController } from './named-account-lists.controller'
import { NamedAccountListsService } from './named-account-lists.service'

@Module({
  controllers: [NamedAccountListsController],
  providers: [NamedAccountListsService],
  exports: [NamedAccountListsService],
})
export class NamedAccountListsModule {}
