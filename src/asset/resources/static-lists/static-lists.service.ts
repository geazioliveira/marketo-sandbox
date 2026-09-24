import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class StaticListsService {
  async getStaticListByIdUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getStaticListByIdUsingGET is not implemented.',
    )
  }

  async updateStaticListUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'updateStaticListUsingPOST is not implemented.',
    )
  }

  async getStaticListsUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getStaticListsUsingGET is not implemented.',
    )
  }

  async createStaticListUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'createStaticListUsingPOST is not implemented.',
    )
  }

  async getStaticListByNameUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getStaticListByNameUsingGET is not implemented.',
    )
  }

  async deleteStaticListByIdUsingPOST(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'deleteStaticListByIdUsingPOST is not implemented.',
    )
  }
}
