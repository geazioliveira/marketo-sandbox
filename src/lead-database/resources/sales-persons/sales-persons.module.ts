import { Module } from '@nestjs/common'
import { SalesPersonsController } from './sales-persons.controller'
import { SalesPersonsService } from './sales-persons.service'

@Module({
  controllers: [SalesPersonsController],
  providers: [SalesPersonsService],
  exports: [SalesPersonsService],
})
export class SalesPersonsModule {}
