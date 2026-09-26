import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import { FileContentsService } from './file-contents.service'

import type { ResponseOfFileResponse } from '../../asset-definitions/responses/response-of-file-response'
import type { UpdateFileContentRequest } from '../../asset-definitions/requests/update-file-content-request'

@Controller()
export class FileContentsController {
  constructor(private readonly fileContentsService: FileContentsService) {}

  @Post('rest/asset/v1/file/:id/content.json')
  @HttpCode(200)
  async updateContentUsingPOST(
    @Param('id') id: number,
    @Body() request: UpdateFileContentRequest,
  ): Promise<ResponseOfFileResponse> {
    return this.fileContentsService.updateContentUsingPOST(id, request)
  }
}
