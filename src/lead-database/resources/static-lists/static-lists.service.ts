import { Injectable } from '@nestjs/common'
import { makeResponseOfLead } from '../../lead-database-mocks/factories/response-of-lead'
import { makeResponseOfLeadByListId } from '../../lead-database-mocks/factories/response-of-lead-by-list-id'
import { makeResponseOfListOperationOutputData } from '../../lead-database-mocks/factories/response-of-list-operation-output-data'
import { makeResponseOfStaticList } from '../../lead-database-mocks/factories/response-of-static-list'

import type { ResponseOfLead } from '../../lead-database-definitions/responses/response-of-lead'
import type { ResponseOfLeadByListId } from '../../lead-database-definitions/responses/response-of-lead-by-list-id'
import type { ResponseOfListOperationOutputData } from '../../lead-database-definitions/responses/response-of-list-operation-output-data'
import type { ResponseOfStaticList } from '../../lead-database-definitions/responses/response-of-static-list'

@Injectable()
export class StaticListsService {
  async getLeadsByListIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLeadByListId> {
    return makeResponseOfLeadByListId()
  }

  async getListsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfStaticList> {
    return makeResponseOfStaticList()
  }

  async getListByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfStaticList> {
    return makeResponseOfStaticList()
  }

  async getLeadsByListIdUsingGET_1(
    ..._arguments: unknown[]
  ): Promise<ResponseOfLead> {
    return makeResponseOfLead()
  }

  async addLeadsToListUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfListOperationOutputData> {
    return makeResponseOfListOperationOutputData()
  }

  async removeLeadsFromListUsingDELETE(
    ..._arguments: unknown[]
  ): Promise<ResponseOfListOperationOutputData> {
    return makeResponseOfListOperationOutputData()
  }

  async areLeadsMemberOfListUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfListOperationOutputData> {
    return makeResponseOfListOperationOutputData()
  }
}
