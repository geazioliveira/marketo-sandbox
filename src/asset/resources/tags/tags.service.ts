import { Injectable } from '@nestjs/common'
import { makeResponseOfTagResponse } from '../../asset-mocks/factories/response-of-tag-response'
import { makeResponseOfTagResponseGetAll } from '../../asset-mocks/factories/response-of-tag-response-get-all'

import type { ResponseOfTagResponse } from '../../asset-definitions/responses/response-of-tag-response'
import type { ResponseOfTagResponseGetAll } from '../../asset-definitions/responses/response-of-tag-response-get-all'

@Injectable()
export class TagsService {
  async getTagByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfTagResponse> {
    return makeResponseOfTagResponse()
  }

  async getTagTypesUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfTagResponseGetAll> {
    return makeResponseOfTagResponseGetAll()
  }
}
