import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class TagsService {
  async getTagByNameUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getTagByNameUsingGET is not implemented.',
    )
  }

  async getTagTypesUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException('getTagTypesUsingGET is not implemented.')
  }
}
