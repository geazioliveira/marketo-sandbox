import { Injectable } from '@nestjs/common'
import { makeObservableOfInputStreamContent } from '../../lead-database-mocks/factories/observable-of-input-stream-content'
import { makeResponseOfImportProgramMemberResponse } from '../../lead-database-mocks/factories/response-of-import-program-member-response'

import type { ObservableOfInputStreamContent } from '../../lead-database-definitions/models/observable-of-input-stream-content'
import type { ResponseOfImportProgramMemberResponse } from '../../lead-database-definitions/responses/response-of-import-program-member-response'

@Injectable()
export class BulkImportProgramMembersService {
  async importProgramMemberUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfImportProgramMemberResponse> {
    return makeResponseOfImportProgramMemberResponse()
  }

  async getImportProgramMemberFailuresUsingGET(
    ..._arguments: unknown[]
  ): Promise<ObservableOfInputStreamContent> {
    return makeObservableOfInputStreamContent()
  }

  async getImportProgramMemberStatusUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfImportProgramMemberResponse> {
    return makeResponseOfImportProgramMemberResponse()
  }

  async getImportProgramMemberWarningsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ObservableOfInputStreamContent> {
    return makeObservableOfInputStreamContent()
  }
}
