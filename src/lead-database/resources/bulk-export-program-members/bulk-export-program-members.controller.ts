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
import { BulkExportProgramMembersService } from './bulk-export-program-members.service'

import type { ExportProgramMemberRequest } from '../../lead-database-definitions/requests/export-program-member-request'
import type { ObservableOfInputStreamRangeContent } from '../../lead-database-definitions/models/observable-of-input-stream-range-content'
import type { ResponseOfExportResponse } from '../../lead-database-definitions/responses/response-of-export-response'
import type { ResponseOfExportResponseWithToken } from '../../lead-database-definitions/responses/response-of-export-response-with-token'

@Controller()
export class BulkExportProgramMembersController {
  constructor(
    private readonly bulkExportProgramMembersService: BulkExportProgramMembersService,
  ) {}

  @Get('bulk/v1/program/members/export.json')
  async getExportProgramMembersUsingGET(
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
    return this.bulkExportProgramMembersService.getExportProgramMembersUsingGET(
      status,
      batchSize,
      nextPageToken,
    )
  }

  @Post('bulk/v1/program/members/export/create.json')
  @HttpCode(200)
  async createExportProgramMembersUsingPOST(
    @Body() exportProgramMemberRequest?: ExportProgramMemberRequest,
  ): Promise<ResponseOfExportResponse> {
    return this.bulkExportProgramMembersService.createExportProgramMembersUsingPOST(
      exportProgramMemberRequest,
    )
  }

  @Post('bulk/v1/program/members/export/:exportId/cancel.json')
  @HttpCode(200)
  async cancelExportProgramMembersUsingPOST(
    @Param('exportId') exportId: string,
  ): Promise<ResponseOfExportResponse> {
    return this.bulkExportProgramMembersService.cancelExportProgramMembersUsingPOST(
      exportId,
    )
  }

  @Post('bulk/v1/program/members/export/:exportId/enqueue.json')
  @HttpCode(200)
  async enqueueExportProgramMembersUsingPOST(
    @Param('exportId') exportId: string,
  ): Promise<ResponseOfExportResponse> {
    return this.bulkExportProgramMembersService.enqueueExportProgramMembersUsingPOST(
      exportId,
    )
  }

  @Get('bulk/v1/program/members/export/:exportId/file.json')
  async getExportProgramMembersFileUsingGET(
    @Param('exportId') exportId: string,
    @Headers('Range') range?: string,
  ): Promise<ObservableOfInputStreamRangeContent> {
    return this.bulkExportProgramMembersService.getExportProgramMembersFileUsingGET(
      exportId,
      range,
    )
  }

  @Get('bulk/v1/program/members/export/:exportId/status.json')
  async getExportProgramMembersStatusUsingGET(
    @Param('exportId') exportId: string,
  ): Promise<ResponseOfExportResponse> {
    return this.bulkExportProgramMembersService.getExportProgramMembersStatusUsingGET(
      exportId,
    )
  }
}
