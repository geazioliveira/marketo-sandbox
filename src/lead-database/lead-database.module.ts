import { Module } from '@nestjs/common'
import { LeadDatabaseResourcesModule } from './resources/lead-database-resources.module'

@Module({
  imports: [LeadDatabaseResourcesModule],
})
export class LeadDatabaseModule {}
