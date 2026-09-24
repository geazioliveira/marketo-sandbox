import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class FilesService {
  async getFileByNameUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getFileByNameUsingGET is not implemented.',
    )
  }

  async getFileByIdUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException('getFileByIdUsingGET is not implemented.')
  }

  async getFilesUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException('getFilesUsingGET is not implemented.')
  }

  async createFileUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException('createFileUsingPOST is not implemented.')
  }
}
