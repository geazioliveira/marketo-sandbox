import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class ProgramsService {
  async getProgramByNameUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getProgramByNameUsingGET is not implemented.',
    )
  }

  async getProgramListByTagUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getProgramListByTagUsingGET is not implemented.',
    )
  }

  async getProgramByIdUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'getProgramByIdUsingGET is not implemented.',
    )
  }

  async updateProgramUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'updateProgramUsingPOST is not implemented.',
    )
  }

  async getSmartListByProgramIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<never> {
    throw new NotImplementedException(
      'getSmartListByProgramIdUsingGET is not implemented.',
    )
  }

  async approveProgramUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'approveProgramUsingPOST is not implemented.',
    )
  }

  async cloneProgramUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'cloneProgramUsingPOST is not implemented.',
    )
  }

  async deleteProgramUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'deleteProgramUsingPOST is not implemented.',
    )
  }

  async unapproveProgramUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'unapproveProgramUsingPOST is not implemented.',
    )
  }

  async browseProgramsUsingGET(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'browseProgramsUsingGET is not implemented.',
    )
  }

  async createProgramUsingPOST(..._arguments: unknown[]): Promise<never> {
    throw new NotImplementedException(
      'createProgramUsingPOST is not implemented.',
    )
  }
}
