import { Module } from '@nestjs/common'
import { BulkImportCustomObjectsController } from './bulk-import-custom-objects.controller'
import { BulkImportCustomObjectsService } from './bulk-import-custom-objects.service'

@Module({
  controllers: [BulkImportCustomObjectsController],
  providers: [BulkImportCustomObjectsService],
  exports: [BulkImportCustomObjectsService],
})
export class BulkImportCustomObjectsModule {}
