import { Module } from '@nestjs/common'
import { BulkImportLeadsController } from './bulk-import-leads.controller'
import { BulkImportLeadsService } from './bulk-import-leads.service'

@Module({
  controllers: [BulkImportLeadsController],
  providers: [BulkImportLeadsService],
  exports: [BulkImportLeadsService],
})
export class BulkImportLeadsModule {}
