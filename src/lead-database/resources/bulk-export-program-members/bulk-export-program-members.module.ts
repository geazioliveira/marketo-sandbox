import { Module } from '@nestjs/common'
import { BulkExportProgramMembersController } from './bulk-export-program-members.controller'
import { BulkExportProgramMembersService } from './bulk-export-program-members.service'

@Module({
  controllers: [BulkExportProgramMembersController],
  providers: [BulkExportProgramMembersService],
  exports: [BulkExportProgramMembersService],
})
export class BulkExportProgramMembersModule {}
