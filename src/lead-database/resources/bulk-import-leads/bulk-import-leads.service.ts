import { Injectable } from '@nestjs/common'
import { makeObservableOfInputStreamContent } from '../../lead-database-mocks/factories/observable-of-input-stream-content'
import { makeResponseOfImportLeadResponse } from '../../lead-database-mocks/factories/response-of-import-lead-response'

import type { ObservableOfInputStreamContent } from '../../lead-database-definitions/models/observable-of-input-stream-content'
import type { ResponseOfImportLeadResponse } from '../../lead-database-definitions/responses/response-of-import-lead-response'

@Injectable()
export class BulkImportLeadsService {
  async importLeadUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfImportLeadResponse> {
    return makeResponseOfImportLeadResponse()
  }

  async getImportLeadStatusUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfImportLeadResponse> {
    return makeResponseOfImportLeadResponse()
  }

  async getImportLeadFailuresUsingGET(
    ..._arguments: unknown[]
  ): Promise<ObservableOfInputStreamContent> {
    return makeObservableOfInputStreamContent()
  }

  async getImportLeadWarningsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ObservableOfInputStreamContent> {
    return makeObservableOfInputStreamContent()
  }
}
