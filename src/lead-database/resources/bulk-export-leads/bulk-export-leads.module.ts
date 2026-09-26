import { Module } from '@nestjs/common'
import { BulkExportLeadsController } from './bulk-export-leads.controller'
import { BulkExportLeadsService } from './bulk-export-leads.service'

@Module({
  controllers: [BulkExportLeadsController],
  providers: [BulkExportLeadsService],
  exports: [BulkExportLeadsService],
})
export class BulkExportLeadsModule {}
