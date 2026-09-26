import { Injectable } from '@nestjs/common'
import { makeResponseOfChangeLeadProgramStatusOutputData } from '../../lead-database-mocks/factories/response-of-change-lead-program-status-output-data'
import { makeResponseOfCreateLeadField } from '../../lead-database-mocks/factories/response-of-create-lead-field'
import { makeResponseOfLead } from '../../lead-database-mocks/factories/response-of-lead'
import { makeResponseOfLeadAttribute } from '../../lead-database-mocks/factories/response-of-lead-attribute'
import { makeResponseOfLeadAttribute2 } from '../../lead-database-mocks/factories/response-of-lead-attribute2'
import { makeResponseOfLeadField } from '../../lead-database-mocks/factories/response-of-lead-field'
import { makeResponseOfLeadPartition } from '../../lead-database-mocks/factories/response-of-lead-partition'
import { makeResponseOfLists } from '../../lead-database-mocks/factories/response-of-lists'
import { makeResponseOfProgramMemberAttributes } from '../../lead-database-mocks/factories/response-of-program-member-attributes'
import { makeResponseOfPrograms } from '../../lead-database-mocks/factories/response-of-programs'
import { makeResponseOfPushLeadToMarketo } from '../../lead-database-mocks/factories/response-of-push-lead-to-marketo'
import { makeResponseOfSmartCampaigns } from '../../lead-database-mocks/factories/response-of-smart-campaigns'
import { makeResponseOfSubmitForm } from '../../lead-database-mocks/factories/response-of-submit-form'
import { makeResponseOfUpdateLeadField } from '../../lead-database-mocks/factories/response-of-update-lead-field'
import { makeResponseWithoutResult } from '../../lead-database-mocks/factories/response-without-result'

import type { ResponseOfChangeLeadProgramStatusOutputData } from '../../lead-database-definitions/responses/response-of-change-lead-program-status-output-data'
import type { ResponseOfCreateLeadField } from '../../lead-database-definitions/responses/response-of-create-lead-field'
import type { ResponseOfLead } from '../../lead-database-definitions/responses/response-of-lead'
import type { ResponseOfLeadAttribute } from '../../lead-database-definitions/responses/response-of-lead-attribute'
import type { ResponseOfLeadAttribute2 } from '../../lead-database-definitions/responses/response-of-lead-attribute2'
import type { ResponseOfLeadField } from '../../lead-database-definitions/responses/response-of-lead-field'
import type { ResponseOfLeadPartition } from '../../lead-database-definitions/responses/response-of-lead-partition'
import type { ResponseOfLists } from '../../lead-database-definitions/responses/response-of-lists'
import type { ResponseOfProgramMemberAttributes } from '../../lead-database-definitions/responses/response-of-program-member-attributes'
import type { ResponseOfPrograms } from '../../lead-database-definitions/responses/response-of-programs'
import type { ResponseOfPushLeadToMarketo } from '../../lead-database-definitions/responses/response-of-push-lead-to-marketo'
import type { ResponseOfSmartCampaigns } from '../../lead-database-definitions/responses/response-of-smart-campaigns'
import type { ResponseOfSubmitForm } from '../../lead-database-definitions/responses/response-of-submit-form'
import type { ResponseOfUpdateLeadField } from '../../lead-database-definitions/responses/response-of-update-lead-field'
import type { ResponseWithoutResult } from '../../lead-database-definitions/models/response-without-result'

@Injectable()
export class LeadsService {
  async getLeadByIdUsingGET(..._arguments: unknown[]): Promise<ResponseOfLead> {
    return makeResponseOfLead()
  }

  async getLeadsByFilterUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLead> {
    return makeResponseOfLead()
  }

  async syncLeadUsingPOST(..._arguments: unknown[]): Promise<ResponseOfLead> {
    return makeResponseOfLead()
  }

  async deleteLeadsUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLead> {
    return makeResponseOfLead()
  }

  async describeUsingGET_2(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLeadAttribute> {
    return makeResponseOfLeadAttribute()
  }

  async describeUsingGET_6(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLeadAttribute2> {
    return makeResponseOfLeadAttribute2()
  }

  async getLeadFieldByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLeadField> {
    return makeResponseOfLeadField()
  }

  async updateLeadFieldUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfUpdateLeadField> {
    return makeResponseOfUpdateLeadField()
  }

  async getLeadFieldsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLeadField> {
    return makeResponseOfLeadField()
  }

  async createLeadFieldUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfCreateLeadField> {
    return makeResponseOfCreateLeadField()
  }

  async describeProgramMemberUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfProgramMemberAttributes> {
    return makeResponseOfProgramMemberAttributes()
  }

  async getLeadPartitionsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLeadPartition> {
    return makeResponseOfLeadPartition()
  }

  async updatePartitionsUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLead> {
    return makeResponseOfLead()
  }

  async getLeadsByProgramIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLead> {
    return makeResponseOfLead()
  }

  async changeLeadProgramStatusUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfChangeLeadProgramStatusOutputData> {
    return makeResponseOfChangeLeadProgramStatusOutputData()
  }

  async pushToMarketoUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfPushLeadToMarketo> {
    return makeResponseOfPushLeadToMarketo()
  }

  async SubmitFormUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSubmitForm> {
    return makeResponseOfSubmitForm()
  }

  async associateLeadUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseWithoutResult> {
    return makeResponseWithoutResult()
  }

  async mergeLeadsUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseWithoutResult> {
    return makeResponseWithoutResult()
  }

  async getListMembershipUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLists> {
    return makeResponseOfLists()
  }

  async getProgramMembershipUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfPrograms> {
    return makeResponseOfPrograms()
  }

  async getSmartCampaignMembershipUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartCampaigns> {
    return makeResponseOfSmartCampaigns()
  }
}
