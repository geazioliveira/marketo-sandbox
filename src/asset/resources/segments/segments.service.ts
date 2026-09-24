import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class SegmentsService {
  async getSegmentationUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getSegmentationUsingGET is not implemented.',
    )
  }

  async getSegmentsForSegmentationUsingGET(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'getSegmentsForSegmentationUsingGET is not implemented.',
    )
  }
}
