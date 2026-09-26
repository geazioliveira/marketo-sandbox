import { Module } from '@nestjs/common'
import { ProgramMembersController } from './program-members.controller'
import { ProgramMembersService } from './program-members.service'

@Module({
  controllers: [ProgramMembersController],
  providers: [ProgramMembersService],
  exports: [ProgramMembersService],
})
export class ProgramMembersModule {}
