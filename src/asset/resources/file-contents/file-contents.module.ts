import { Module } from '@nestjs/common'
import { FileContentsController } from './file-contents.controller'
import { FileContentsService } from './file-contents.service'

@Module({
  controllers: [FileContentsController],
  providers: [FileContentsService],
})
export class FileContentsModule {}
