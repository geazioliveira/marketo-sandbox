import { Module } from '@nestjs/common'
import { AssetModule } from './asset/asset.module'
import { DataIngestionModule } from './data-ingestion/data-ingestion.module'
import { IdentityModule } from './identity/identity.module'
import { LeadDatabaseModule } from './lead-database/lead-database.module'
import { UserManagementModule } from './user-management/user-management.module'

@Module({
  imports: [
    AssetModule,
    DataIngestionModule,
    IdentityModule,
    LeadDatabaseModule,
    UserManagementModule,
  ],
})
export class AppModule {}
