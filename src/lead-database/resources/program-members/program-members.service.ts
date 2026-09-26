import { Injectable } from '@nestjs/common'
import { makeResponseOfCreateLeadField } from '../../lead-database-mocks/factories/response-of-create-lead-field'
import { makeResponseOfLeadField } from '../../lead-database-mocks/factories/response-of-lead-field'
import { makeResponseOfProgramMember } from '../../lead-database-mocks/factories/response-of-program-member'
import { makeResponseOfProgramMemberAttributes2 } from '../../lead-database-mocks/factories/response-of-program-member-attributes2'
import { makeResponseOfProgramMemberData } from '../../lead-database-mocks/factories/response-of-program-member-data'
import { makeResponseOfProgramMemberDelete } from '../../lead-database-mocks/factories/response-of-program-member-delete'
import { makeResponseOfProgramMemberStatus } from '../../lead-database-mocks/factories/response-of-program-member-status'
import { makeResponseOfUpdateLeadField } from '../../lead-database-mocks/factories/response-of-update-lead-field'

import type { ResponseOfCreateLeadField } from '../../lead-database-definitions/responses/response-of-create-lead-field'
import type { ResponseOfLeadField } from '../../lead-database-definitions/responses/response-of-lead-field'
import type { ResponseOfProgramMember } from '../../lead-database-definitions/responses/response-of-program-member'
import type { ResponseOfProgramMemberAttributes2 } from '../../lead-database-definitions/responses/response-of-program-member-attributes2'
import type { ResponseOfProgramMemberData } from '../../lead-database-definitions/responses/response-of-program-member-data'
import type { ResponseOfProgramMemberDelete } from '../../lead-database-definitions/responses/response-of-program-member-delete'
import type { ResponseOfProgramMemberStatus } from '../../lead-database-definitions/responses/response-of-program-member-status'
import type { ResponseOfUpdateLeadField } from '../../lead-database-definitions/responses/response-of-update-lead-field'

@Injectable()
export class ProgramMembersService {
  async getProgramMemberFieldByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLeadField> {
    return makeResponseOfLeadField()
  }

  async updateProgramMemberFieldUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfUpdateLeadField> {
    return makeResponseOfUpdateLeadField()
  }

  async getProgramMemberFieldsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLeadField> {
    return makeResponseOfLeadField()
  }

  async createProgramMemberFieldUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfCreateLeadField> {
    return makeResponseOfCreateLeadField()
  }

  async syncProgramMemberStatusUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramMemberStatus> {
    return makeResponseOfProgramMemberStatus()
  }

  async getProgramMembersUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramMember> {
    return makeResponseOfProgramMember()
  }

  async syncProgramMemberDataUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramMemberData> {
    return makeResponseOfProgramMemberData()
  }

  async deleteProgramMemberUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramMemberDelete> {
    return makeResponseOfProgramMemberDelete()
  }

  async describeProgramMemberUsingGET2(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramMemberAttributes2> {
    return makeResponseOfProgramMemberAttributes2()
  }
}
