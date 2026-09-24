import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class FileContentsService {
  async updateContentUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'updateContentUsingPOST is not implemented.',
    )
  }
}
