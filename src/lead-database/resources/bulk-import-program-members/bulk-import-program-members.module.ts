import { Module } from '@nestjs/common'
import { BulkImportProgramMembersController } from './bulk-import-program-members.controller'
import { BulkImportProgramMembersService } from './bulk-import-program-members.service'

@Module({
  controllers: [BulkImportProgramMembersController],
  providers: [BulkImportProgramMembersService],
  exports: [BulkImportProgramMembersService],
})
export class BulkImportProgramMembersModule {}
