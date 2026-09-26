import { Module } from '@nestjs/common'
import { NamedAccountsController } from './named-accounts.controller'
import { NamedAccountsService } from './named-accounts.service'

@Module({
  controllers: [NamedAccountsController],
  providers: [NamedAccountsService],
  exports: [NamedAccountsService],
})
export class NamedAccountsModule {}
