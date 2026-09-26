import { Module } from '@nestjs/common'
import { DataIngestionResourcesModule } from './resources/data-ingestion-resources.module'

@Module({
  imports: [DataIngestionResourcesModule],
})
export class DataIngestionModule {}
