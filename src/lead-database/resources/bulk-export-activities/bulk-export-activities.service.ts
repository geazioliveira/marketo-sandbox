import { Injectable } from '@nestjs/common'
import { makeObservableOfInputStreamRangeContent } from '../../lead-database-mocks/factories/observable-of-input-stream-range-content'
import { makeResponseOfExportResponse } from '../../lead-database-mocks/factories/response-of-export-response'
import { makeResponseOfExportResponseWithToken } from '../../lead-database-mocks/factories/response-of-export-response-with-token'

import type { ObservableOfInputStreamRangeContent } from '../../lead-database-definitions/models/observable-of-input-stream-range-content'
import type { ResponseOfExportResponse } from '../../lead-database-definitions/responses/response-of-export-response'
import type { ResponseOfExportResponseWithToken } from '../../lead-database-definitions/responses/response-of-export-response-with-token'

@Injectable()
export class BulkExportActivitiesService {
  async getExportActivitiesUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfExportResponseWithToken> {
    return makeResponseOfExportResponseWithToken()
  }

  async createExportActivitiesUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfExportResponse> {
    return makeResponseOfExportResponse()
  }

  async cancelExportActivitiesUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfExportResponse> {
    return makeResponseOfExportResponse()
  }

  async enqueueExportActivitiesUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfExportResponse> {
    return makeResponseOfExportResponse()
  }

  async getExportActivitiesFileUsingGET(
    ..._arguments: unknown[]
  ): Promise<ObservableOfInputStreamRangeContent> {
    return makeObservableOfInputStreamRangeContent()
  }

  async getExportActivitiesStatusUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfExportResponse> {
    return makeResponseOfExportResponse()
  }
}
