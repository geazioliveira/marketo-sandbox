import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class TokensService {
  async getTokensByFolderIdUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getTokensByFolderIdUsingGET is not implemented.',
    )
  }

  async addTokenTOFolderUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'addTokenTOFolderUsingPOST is not implemented.',
    )
  }

  async deleteTokenByNameUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'deleteTokenByNameUsingPOST is not implemented.',
    )
  }
}
