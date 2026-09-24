import { Controller, Get, Param, Query } from '@nestjs/common'
import { SegmentsService } from './segments.service'

import type { ResponseOfSegmentationResponse } from '../../asset-definitions/responses/response-of-segmentation-response'
import type { ResponseOfSegmentsResponse } from '../../asset-definitions/responses/response-of-segments-response'

@Controller()
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Get('rest/asset/v1/segmentation.json')
  async getSegmentationUsingGET(
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfSegmentationResponse> {
    return this.segmentsService.getSegmentationUsingGET(status)
  }

  @Get('rest/asset/v1/segmentation/:id/segments.json')
  async getSegmentsForSegmentationUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
    @Query('offset') offset?: number,
    @Query('maxReturn') maxReturn?: number,
  ): Promise<ResponseOfSegmentsResponse> {
    return this.segmentsService.getSegmentsForSegmentationUsingGET(
      id,
      status,
      offset,
      maxReturn,
    )
  }
}
