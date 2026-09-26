import { Module } from '@nestjs/common'
import { UserManagementResourcesModule } from './resources/user-management-resources.module'

@Module({
  imports: [UserManagementResourcesModule],
})
export class UserManagementModule {}
