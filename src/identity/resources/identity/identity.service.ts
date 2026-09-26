import { Injectable } from '@nestjs/common'
import { makeResponseOfIdentity } from '../../identity-mocks/factories/response-of-identity'

import type { ResponseOfIdentity } from '../../identity-definitions/responses/response-of-identity'

@Injectable()
export class IdentityService {
  async identityUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdentity> {
    return makeResponseOfIdentity()
  }

  async identityUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdentity> {
    return makeResponseOfIdentity()
  }
}
