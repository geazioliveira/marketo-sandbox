import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { BulkImportCustomObjectsService } from './bulk-import-custom-objects.service'

import type { ObservableOfInputStreamContent } from '../../lead-database-definitions/models/observable-of-input-stream-content'
import type { ResponseOfImportCustomObjectResponse } from '../../lead-database-definitions/responses/response-of-import-custom-object-response'

@Controller()
export class BulkImportCustomObjectsController {
  constructor(
    private readonly bulkImportCustomObjectsService: BulkImportCustomObjectsService,
  ) {}

  @Post('bulk/v1/customobjects/:apiName/import.json')
  @HttpCode(200)
  async importCustomObjectUsingPOST(
    @Param('apiName') apiName: string,
    @Query('format') format: 'csv' | 'tsv' | 'ssv',
    @Body('file') file: unknown,
  ): Promise<ResponseOfImportCustomObjectResponse> {
    return this.bulkImportCustomObjectsService.importCustomObjectUsingPOST(
      apiName,
      format,
      file,
    )
  }

  @Get('bulk/v1/customobjects/:apiName/import/:batchId/failures.json')
  async getImportCustomObjectFailuresUsingGET(
    @Param('apiName') apiName: string,
    @Param('batchId') batchId: number,
  ): Promise<ObservableOfInputStreamContent> {
    return this.bulkImportCustomObjectsService.getImportCustomObjectFailuresUsingGET(
      apiName,
      batchId,
    )
  }

  @Get('bulk/v1/customobjects/:apiName/import/:batchId/status.json')
  async getImportCustomObjectStatusUsingGET(
    @Param('apiName') apiName: string,
    @Param('batchId') batchId: number,
  ): Promise<ResponseOfImportCustomObjectResponse> {
    return this.bulkImportCustomObjectsService.getImportCustomObjectStatusUsingGET(
      apiName,
      batchId,
    )
  }

  @Get('bulk/v1/customobjects/:apiName/import/:batchId/warnings.json')
  async getImportCustomObjectWarningsUsingGET(
    @Param('apiName') apiName: string,
    @Param('batchId') batchId: number,
  ): Promise<ObservableOfInputStreamContent> {
    return this.bulkImportCustomObjectsService.getImportCustomObjectWarningsUsingGET(
      apiName,
      batchId,
    )
  }
}
