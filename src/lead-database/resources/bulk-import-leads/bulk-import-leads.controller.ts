import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { BulkImportLeadsService } from './bulk-import-leads.service'

import type { ObservableOfInputStreamContent } from '../../lead-database-definitions/models/observable-of-input-stream-content'
import type { ResponseOfImportLeadResponse } from '../../lead-database-definitions/responses/response-of-import-lead-response'

@Controller()
export class BulkImportLeadsController {
  constructor(
    private readonly bulkImportLeadsService: BulkImportLeadsService,
  ) {}

  @Post('bulk/v1/leads.json')
  @HttpCode(200)
  async importLeadUsingPOST(
    @Query('format') format: 'csv' | 'tsv' | 'ssv',
    @Body('file') file: unknown,
    @Query('lookupField') lookupField?: string,
    @Query('partitionName') partitionName?: string,
    @Query('listId') listId?: number,
  ): Promise<ResponseOfImportLeadResponse> {
    return this.bulkImportLeadsService.importLeadUsingPOST(
      format,
      file,
      lookupField,
      partitionName,
      listId,
    )
  }

  @Get('bulk/v1/leads/batch/:batchId.json')
  async getImportLeadStatusUsingGET(
    @Param('batchId') batchId: number,
  ): Promise<ResponseOfImportLeadResponse> {
    return this.bulkImportLeadsService.getImportLeadStatusUsingGET(batchId)
  }

  @Get('bulk/v1/leads/batch/:batchId/failures.json')
  async getImportLeadFailuresUsingGET(
    @Param('batchId') batchId: number,
  ): Promise<ObservableOfInputStreamContent> {
    return this.bulkImportLeadsService.getImportLeadFailuresUsingGET(batchId)
  }

  @Get('bulk/v1/leads/batch/:batchId/warnings.json')
  async getImportLeadWarningsUsingGET(
    @Param('batchId') batchId: number,
  ): Promise<ObservableOfInputStreamContent> {
    return this.bulkImportLeadsService.getImportLeadWarningsUsingGET(batchId)
  }
}
