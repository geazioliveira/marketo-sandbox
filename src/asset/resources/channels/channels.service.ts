import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class ChannelsService {
  async getChannelByNameUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getChannelByNameUsingGET is not implemented.',
    )
  }

  async getAllChannelsUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getAllChannelsUsingGET is not implemented.',
    )
  }
}
