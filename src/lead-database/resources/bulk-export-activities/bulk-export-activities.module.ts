import { Module } from '@nestjs/common'
import { BulkExportActivitiesController } from './bulk-export-activities.controller'
import { BulkExportActivitiesService } from './bulk-export-activities.service'

@Module({
  controllers: [BulkExportActivitiesController],
  providers: [BulkExportActivitiesService],
  exports: [BulkExportActivitiesService],
})
export class BulkExportActivitiesModule {}
