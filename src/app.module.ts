import { Module } from '@nestjs/common'
import { createObserveModule } from '@nestjs/observe'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AssetModule } from './asset/asset.module'
import { DataIngestionModule } from './data-ingestion/data-ingestion.module'
import { IdentityModule } from './identity/identity.module'
import { LeadDatabaseModule } from './lead-database/lead-database.module'
import { UserManagementModule } from './user-management/user-management.module'

export const { ObserveModule, ObserveInstrument } = createObserveModule()

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? '',
      appSecret: process.env.OBSERVE_APP_SECRET ?? '',
      runtimeMetrics: !Boolean(process.versions?.['webcontainer']),
      serviceId: 'nest-typescript-starter',
    }),
    AssetModule,
    DataIngestionModule,
    IdentityModule,
    LeadDatabaseModule,
    UserManagementModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
