import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class LandingPageContentService {
  async getLandingPageContentUsingGET(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'getLandingPageContentUsingGET is not implemented.',
    )
  }

  async addLandingPageContentUsingPOST(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'addLandingPageContentUsingPOST is not implemented.',
    )
  }

  async updateLandingPageContentUsingPOST(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'updateLandingPageContentUsingPOST is not implemented.',
    )
  }

  async removeLandingPageContentUsingPOST(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'removeLandingPageContentUsingPOST is not implemented.',
    )
  }

  async getLandingPageDynamicContentsUsingGET(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'getLandingPageDynamicContentsUsingGET is not implemented.',
    )
  }

  async updateLandingPageDynamicContentUsingPOST(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'updateLandingPageDynamicContentUsingPOST is not implemented.',
    )
  }
}
