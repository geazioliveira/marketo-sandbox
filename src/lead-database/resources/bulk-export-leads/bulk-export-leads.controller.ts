import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { BulkExportLeadsService } from './bulk-export-leads.service'

import type { ExportLeadRequest } from '../../lead-database-definitions/requests/export-lead-request'
import type { ObservableOfInputStreamRangeContent } from '../../lead-database-definitions/models/observable-of-input-stream-range-content'
import type { ResponseOfExportResponse } from '../../lead-database-definitions/responses/response-of-export-response'
import type { ResponseOfExportResponseWithToken } from '../../lead-database-definitions/responses/response-of-export-response-with-token'

@Controller()
export class BulkExportLeadsController {
  constructor(
    private readonly bulkExportLeadsService: BulkExportLeadsService,
  ) {}

  @Get('bulk/v1/leads/export.json')
  async getExportLeadsUsingGET(
    @Query('status')
    status?:
      | 'created'
      | 'queued'
      | 'processing'
      | 'cancelled'
      | 'completed'
      | 'failed',
    @Query('batchSize') batchSize?: number,
    @Query('nextPageToken') nextPageToken?: string,
  ): Promise<ResponseOfExportResponseWithToken> {
    return this.bulkExportLeadsService.getExportLeadsUsingGET(
      status,
      batchSize,
      nextPageToken,
    )
  }

  @Post('bulk/v1/leads/export/create.json')
  @HttpCode(200)
  async createExportLeadsUsingPOST(
    @Body() exportLeadRequest?: ExportLeadRequest,
  ): Promise<ResponseOfExportResponse> {
    return this.bulkExportLeadsService.createExportLeadsUsingPOST(
      exportLeadRequest,
    )
  }

  @Post('bulk/v1/leads/export/:exportId/cancel.json')
  @HttpCode(200)
  async cancelExportLeadsUsingPOST(
    @Param('exportId') exportId: string,
  ): Promise<ResponseOfExportResponse> {
    return this.bulkExportLeadsService.cancelExportLeadsUsingPOST(exportId)
  }

  @Post('bulk/v1/leads/export/:exportId/enqueue.json')
  @HttpCode(200)
  async enqueueExportLeadsUsingPOST(
    @Param('exportId') exportId: string,
  ): Promise<ResponseOfExportResponse> {
    return this.bulkExportLeadsService.enqueueExportLeadsUsingPOST(exportId)
  }

  @Get('bulk/v1/leads/export/:exportId/file.json')
  async getExportLeadsFileUsingGET(
    @Param('exportId') exportId: string,
    @Headers('Range') range?: string,
  ): Promise<ObservableOfInputStreamRangeContent> {
    return this.bulkExportLeadsService.getExportLeadsFileUsingGET(
      exportId,
      range,
    )
  }

  @Get('bulk/v1/leads/export/:exportId/status.json')
  async getExportLeadsStatusUsingGET(
    @Param('exportId') exportId: string,
  ): Promise<ResponseOfExportResponse> {
    return this.bulkExportLeadsService.getExportLeadsStatusUsingGET(exportId)
  }
}
