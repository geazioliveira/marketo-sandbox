import { Injectable } from '@nestjs/common'
import { makeResponseOfAutoSuggestValue } from '../../asset-mocks/factories/response-of-auto-suggest-value'
import { makeResponseOfIdResponse } from '../../asset-mocks/factories/response-of-id-response'
import { makeResponseOfSmartListResponse } from '../../asset-mocks/factories/response-of-smart-list-response'
import { makeResponseOfSmartListResponseWithRules } from '../../asset-mocks/factories/response-of-smart-list-response-with-rules'
import { makeResponseOfSmartListRuleType } from '../../asset-mocks/factories/response-of-smart-list-rule-type'

import type { ResponseOfAutoSuggestValue } from '../../asset-definitions/models/response-of-auto-suggest-value'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfSmartListResponse } from '../../asset-definitions/responses/response-of-smart-list-response'
import type { ResponseOfSmartListResponseWithRules } from '../../asset-definitions/models/response-of-smart-list-response-with-rules'
import type { ResponseOfSmartListRuleType } from '../../asset-definitions/models/response-of-smart-list-rule-type'

@Injectable()
export class SmartListsService {
  async getSmartListByIdUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponseWithRules> {
    return makeResponseOfSmartListResponseWithRules()
  }

  async getSmartListByNameUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponse> {
    return makeResponseOfSmartListResponse()
  }

  async deleteSmartListByIdUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async getSmartListsUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponse> {
    return makeResponseOfSmartListResponse()
  }

  async createSmartListUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponse> {
    return makeResponseOfSmartListResponse()
  }

  async getSmartListRulesUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListRuleType> {
    return makeResponseOfSmartListRuleType()
  }

  async getSmartListAutoSuggestUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfAutoSuggestValue> {
    return makeResponseOfAutoSuggestValue()
  }

  async addSmartListRuleUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponseWithRules> {
    return makeResponseOfSmartListResponseWithRules()
  }

  async updateSmartListRuleUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponseWithRules> {
    return makeResponseOfSmartListResponseWithRules()
  }

  async updateSmartListFilterLogicUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponseWithRules> {
    return makeResponseOfSmartListResponseWithRules()
  }

  async deleteSmartListRuleUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfIdResponse> {
    return makeResponseOfIdResponse()
  }

  async removeSmartListRuleConstraintUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponseWithRules> {
    return makeResponseOfSmartListResponseWithRules()
  }

  async reorderSmartListRulesUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponseWithRules> {
    return makeResponseOfSmartListResponseWithRules()
  }

  async deleteAllSmartListRulesUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponseWithRules> {
    return makeResponseOfSmartListResponseWithRules()
  }

  async cloneSmartListUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfSmartListResponse> {
    return makeResponseOfSmartListResponse()
  }
}
