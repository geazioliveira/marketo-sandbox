import { Injectable } from '@nestjs/common'
import { makeResponseOfFileResponse } from '../../asset-mocks/factories/response-of-file-response'

import type { ResponseOfFileResponse } from '../../asset-definitions/responses/response-of-file-response'

@Injectable()
export class FileContentsService {
  async updateContentUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfFileResponse> {
    return makeResponseOfFileResponse()
  }
}
