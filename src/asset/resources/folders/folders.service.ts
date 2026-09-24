import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class FoldersService {
  async getFolderByNameUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getFolderByNameUsingGET is not implemented.',
    )
  }

  async getFolderByIdUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getFolderByIdUsingGET is not implemented.',
    )
  }

  async updateFolderUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'updateFolderUsingPOST is not implemented.',
    )
  }

  async getFolderContentUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getFolderContentUsingGET is not implemented.',
    )
  }

  async deleteFolderUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'deleteFolderUsingPOST is not implemented.',
    )
  }

  async getFolderUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException('getFolderUsingGET is not implemented.')
  }

  async createFolderUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'createFolderUsingPOST is not implemented.',
    )
  }
}
