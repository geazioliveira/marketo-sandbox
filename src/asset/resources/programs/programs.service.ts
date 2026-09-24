import { Injectable } from '@nestjs/common'
import { makeResponseOfBrowseAllPrograms } from '../../asset-mocks/factories/response-of-browse-all-programs'
import { makeResponseOfIdResponse } from '../../asset-mocks/factories/response-of-id-response'
import { makeResponseOfProgramResponse } from '../../asset-mocks/factories/response-of-program-response'
import { makeResponseOfSmartListResponseWithRules } from '../../asset-mocks/factories/response-of-smart-list-response-with-rules'

import type { ResponseOfBrowseAllPrograms } from '../../asset-definitions/models/response-of-browse-all-programs'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfProgramResponse } from '../../asset-definitions/responses/response-of-program-response'
import type { ResponseOfSmartListResponseWithRules } from '../../asset-definitions/models/response-of-smart-list-response-with-rules'

@Injectable()
export class ProgramsService {
  async getProgramByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramResponse> {
    return makeResponseOfProgramResponse()
  }

  async getProgramListByTagUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramResponse> {
    return makeResponseOfProgramResponse()
  }

  async getProgramByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramResponse> {
    return makeResponseOfProgramResponse()
  }

  async updateProgramUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramResponse> {
    return makeResponseOfProgramResponse()
  }

  async getSmartListByProgramIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponseWithRules> {
    return makeResponseOfSmartListResponseWithRules()
  }

  async approveProgramUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async cloneProgramUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramResponse> {
    return makeResponseOfProgramResponse()
  }

  async deleteProgramUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async unapproveProgramUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async browseProgramsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfBrowseAllPrograms> {
    return makeResponseOfBrowseAllPrograms()
  }

  async createProgramUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramResponse> {
    return makeResponseOfProgramResponse()
  }
}
