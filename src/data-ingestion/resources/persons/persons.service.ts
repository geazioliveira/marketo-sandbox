import { Injectable } from '@nestjs/common'

@Injectable()
export class PersonsService {
  async syncPersons(..._arguments: unknown[]): Promise<void> {}
}
