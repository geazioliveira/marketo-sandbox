import { Module } from '@nestjs/common'
import { IdentityResourcesModule } from './resources/identity-resources.module'

@Module({
  imports: [IdentityResourcesModule],
})
export class IdentityModule {}
