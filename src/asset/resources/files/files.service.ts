import { Injectable } from '@nestjs/common'
import { makeResponseOfFileResponse } from '../../asset-mocks/factories/response-of-file-response'

import type { ResponseOfFileResponse } from '../../asset-definitions/responses/response-of-file-response'

@Injectable()
export class FilesService {
  async getFileByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfFileResponse> {
    return makeResponseOfFileResponse()
  }

  async getFileByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfFileResponse> {
    return makeResponseOfFileResponse()
  }

  async getFilesUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfFileResponse> {
    return makeResponseOfFileResponse()
  }

  async createFileUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfFileResponse> {
    return makeResponseOfFileResponse()
  }
}
