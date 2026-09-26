import { Injectable } from '@nestjs/common'
import { makeObservableOfInputStreamContent } from '../../lead-database-mocks/factories/observable-of-input-stream-content'
import { makeResponseOfImportCustomObjectResponse } from '../../lead-database-mocks/factories/response-of-import-custom-object-response'

import type { ObservableOfInputStreamContent } from '../../lead-database-definitions/models/observable-of-input-stream-content'
import type { ResponseOfImportCustomObjectResponse } from '../../lead-database-definitions/responses/response-of-import-custom-object-response'

@Injectable()
export class BulkImportCustomObjectsService {
  async importCustomObjectUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfImportCustomObjectResponse> {
    return makeResponseOfImportCustomObjectResponse()
  }

  async getImportCustomObjectFailuresUsingGET(
    ..._arguments: unknown[]
  ): Promise<ObservableOfInputStreamContent> {
    return makeObservableOfInputStreamContent()
  }

  async getImportCustomObjectStatusUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfImportCustomObjectResponse> {
    return makeResponseOfImportCustomObjectResponse()
  }

  async getImportCustomObjectWarningsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ObservableOfInputStreamContent> {
    return makeObservableOfInputStreamContent()
  }
}
