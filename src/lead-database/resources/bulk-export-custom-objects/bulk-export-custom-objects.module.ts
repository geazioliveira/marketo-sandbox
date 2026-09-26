import { Module } from '@nestjs/common'
import { BulkExportCustomObjectsController } from './bulk-export-custom-objects.controller'
import { BulkExportCustomObjectsService } from './bulk-export-custom-objects.service'

@Module({
  controllers: [BulkExportCustomObjectsController],
  providers: [BulkExportCustomObjectsService],
  exports: [BulkExportCustomObjectsService],
})
export class BulkExportCustomObjectsModule {}
