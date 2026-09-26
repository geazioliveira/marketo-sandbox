import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { SmartCampaignsService } from './smart-campaigns.service'

import type { CloneSmartCampaignRequest } from '../../asset-definitions/requests/clone-smart-campaign-request'
import type { CreateSmartCampaignRequest } from '../../asset-definitions/requests/create-smart-campaign-request'
import type { ResponseOfAutoSuggestValue } from '../../asset-definitions/responses/response-of-auto-suggest-value'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfSmartCampaignFlowStepActionType } from '../../asset-definitions/responses/response-of-smart-campaign-flow-step-action-type'
import type { ResponseOfSmartCampaignFlowStepType } from '../../asset-definitions/responses/response-of-smart-campaign-flow-step-type'
import type { ResponseOfSmartCampaignResponse } from '../../asset-definitions/responses/response-of-smart-campaign-response'
import type { ResponseOfSmartCampaignResponseWithFlow } from '../../asset-definitions/responses/response-of-smart-campaign-response-with-flow'
import type { ResponseOfSmartCampaignRuleType } from '../../asset-definitions/responses/response-of-smart-campaign-rule-type'
import type { ResponseOfSmartCampaignUsedBy } from '../../asset-definitions/responses/response-of-smart-campaign-used-by'
import type { ResponseOfSmartListResponseWithRules } from '../../asset-definitions/responses/response-of-smart-list-response-with-rules'
import type { UpdateSmartCampaignRequest } from '../../asset-definitions/requests/update-smart-campaign-request'

@Controller()
export class SmartCampaignsController {
  constructor(private readonly smartCampaignsService: SmartCampaignsService) {}

  @Get('rest/asset/v1/smartCampaign/byName.json')
  async getSmartCampaignByNameUsingGET(
    @Query('name') name: string,
    @Query('includeFlowSteps') includeFlowSteps?: boolean,
  ): Promise<ResponseOfSmartCampaignResponseWithFlow> {
    return this.smartCampaignsService.getSmartCampaignByNameUsingGET(
      name,
      includeFlowSteps,
    )
  }

  @Get('rest/asset/v1/smartCampaign/rules.json')
  async getSmartCampaignRulesUsingGET(): Promise<ResponseOfSmartCampaignRuleType> {
    return this.smartCampaignsService.getSmartCampaignRulesUsingGET()
  }

  @Get('rest/asset/v1/smartCampaign/flowSteps.json')
  async getSmartCampaignFlowStepsUsingGET(): Promise<ResponseOfSmartCampaignFlowStepActionType> {
    return this.smartCampaignsService.getSmartCampaignFlowStepsUsingGET()
  }

  @Get('rest/asset/v1/smartCampaign/flowStepTypes.json')
  async getSmartCampaignFlowStepTypesUsingGET(): Promise<ResponseOfSmartCampaignFlowStepType> {
    return this.smartCampaignsService.getSmartCampaignFlowStepTypesUsingGET()
  }

  @Get('rest/asset/v1/smartCampaign/:id.json')
  async getSmartCampaignByIdUsingGET(
    @Param('id') id: number,
    @Query('includeFlowSteps') includeFlowSteps?: boolean,
  ): Promise<ResponseOfSmartCampaignResponseWithFlow> {
    return this.smartCampaignsService.getSmartCampaignByIdUsingGET(
      id,
      includeFlowSteps,
    )
  }

  @Post('rest/asset/v1/smartCampaign/:id.json')
  @HttpCode(200)
  async updateSmartCampaignUsingPOST(
    @Param('id') id: number,
    @Body() updateSmartCampaignRequest: UpdateSmartCampaignRequest,
  ): Promise<ResponseOfSmartCampaignResponse> {
    return this.smartCampaignsService.updateSmartCampaignUsingPOST(
      id,
      updateSmartCampaignRequest,
    )
  }

  @Get('rest/asset/v1/smartCampaign/:id/usedBy.json')
  async getSmartCampaignUsedByUsingGET(
    @Param('id') id: number,
    @Query('offset') offset?: number,
    @Query('maxReturn') maxReturn?: number,
    @Query('sortByColumn') sortByColumn?: 'updatedAt' | 'name' | 'updated_at',
    @Query('order') order?: 'asc' | 'desc',
    @Query('query') query?: string,
  ): Promise<ResponseOfSmartCampaignUsedBy> {
    return this.smartCampaignsService.getSmartCampaignUsedByUsingGET(
      id,
      offset,
      maxReturn,
      sortByColumn,
      order,
      query,
    )
  }

  @Get('rest/asset/v1/smartCampaign/:id/autoSuggest.json')
  async getSmartCampaignAutoSuggestUsingGET(
    @Param('id') id: number,
    @Query('ruleTypeId') ruleTypeId: string,
    @Query('optionTypeId') optionTypeId: string,
    @Query('primaryAttributeValue') primaryAttributeValue?: string,
  ): Promise<ResponseOfAutoSuggestValue> {
    return this.smartCampaignsService.getSmartCampaignAutoSuggestUsingGET(
      id,
      ruleTypeId,
      optionTypeId,
      primaryAttributeValue,
    )
  }

  @Post('rest/asset/v1/smartCampaign/:id/flows.json')
  @HttpCode(200)
  async addSmartCampaignFlowStepUsingPOST(
    @Param('id') id: number,
    @Body('activityType') activityType: string,
    @Body('index') index: number,
  ): Promise<ResponseOfSmartCampaignResponseWithFlow> {
    return this.smartCampaignsService.addSmartCampaignFlowStepUsingPOST(
      id,
      activityType,
      index,
    )
  }

  @Post('rest/asset/v1/smartCampaign/:id/flow/:stepId/addChoice.json')
  @HttpCode(200)
  async addSmartCampaignFlowStepChoiceUsingPOST(
    @Param('id') id: number,
    @Param('stepId') stepId: number,
  ): Promise<ResponseOfSmartCampaignResponseWithFlow> {
    return this.smartCampaignsService.addSmartCampaignFlowStepChoiceUsingPOST(
      id,
      stepId,
    )
  }

  @Post('rest/asset/v1/smartCampaign/:id/flow/:stepId/choice/:choiceId.json')
  @HttpCode(200)
  async updateSmartCampaignFlowStepChoiceUsingPOST(
    @Param('id') id: number,
    @Param('stepId') stepId: number,
    @Param('choiceId') choiceId: number,
    @Body('operator') operator?: string,
    @Body('conditionTypeId') conditionTypeId?: string,
    @Body('conditionValues') conditionValues?: string,
    @Body('attributes') attributes?: string,
  ): Promise<ResponseOfSmartCampaignResponseWithFlow> {
    return this.smartCampaignsService.updateSmartCampaignFlowStepChoiceUsingPOST(
      id,
      stepId,
      choiceId,
      operator,
      conditionTypeId,
      conditionValues,
      attributes,
    )
  }

  @Post('rest/asset/v1/smartCampaign/:id/flow/:stepId/remove.json')
  @HttpCode(200)
  async removeSmartCampaignFlowStepUsingPOST(
    @Param('id') id: number,
    @Param('stepId') stepId: number,
  ): Promise<ResponseOfSmartCampaignResponseWithFlow> {
    return this.smartCampaignsService.removeSmartCampaignFlowStepUsingPOST(
      id,
      stepId,
    )
  }

  @Post(
    'rest/asset/v1/smartCampaign/:id/flow/:stepId/choice/:choiceId/remove.json',
  )
  @HttpCode(200)
  async removeSmartCampaignFlowStepChoiceUsingPOST(
    @Param('id') id: number,
    @Param('stepId') stepId: number,
    @Param('choiceId') choiceId: number,
  ): Promise<ResponseOfSmartCampaignResponseWithFlow> {
    return this.smartCampaignsService.removeSmartCampaignFlowStepChoiceUsingPOST(
      id,
      stepId,
      choiceId,
    )
  }

  @Post(
    'rest/asset/v1/smartCampaign/:id/flow/:stepId/choice/:choiceId/reorder.json',
  )
  @HttpCode(200)
  async reorderSmartCampaignFlowStepChoiceUsingPOST(
    @Param('id') id: number,
    @Param('stepId') stepId: number,
    @Param('choiceId') choiceId: number,
    @Query('newSeqNumZeroBased') newSeqNumZeroBased: number,
  ): Promise<ResponseOfSmartCampaignResponseWithFlow> {
    return this.smartCampaignsService.reorderSmartCampaignFlowStepChoiceUsingPOST(
      id,
      stepId,
      choiceId,
      newSeqNumZeroBased,
    )
  }

  @Get('rest/asset/v1/smartCampaign/:id/smartList.json')
  async getSmartListBySmartCampaignIdUsingGET(
    @Param('id') id: number,
    @Query('includeRules') includeRules?: boolean,
  ): Promise<ResponseOfSmartListResponseWithRules> {
    return this.smartCampaignsService.getSmartListBySmartCampaignIdUsingGET(
      id,
      includeRules,
    )
  }

  @Get('rest/asset/v1/smartCampaigns.json')
  async getAllSmartCampaignsGET(
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
    @Query('folder') folder?: string,
    @Query('earliestUpdatedAt') earliestUpdatedAt?: string,
    @Query('latestUpdatedAt') latestUpdatedAt?: string,
    @Query('isActive') isActive?: boolean,
  ): Promise<ResponseOfSmartCampaignResponse> {
    return this.smartCampaignsService.getAllSmartCampaignsGET(
      maxReturn,
      offset,
      folder,
      earliestUpdatedAt,
      latestUpdatedAt,
      isActive,
    )
  }

  @Post('rest/asset/v1/smartCampaigns.json')
  @HttpCode(200)
  async createSmartCampaignUsingPOST(
    @Body() createSmartCampaignRequest: CreateSmartCampaignRequest,
  ): Promise<ResponseOfSmartCampaignResponse> {
    return this.smartCampaignsService.createSmartCampaignUsingPOST(
      createSmartCampaignRequest,
    )
  }

  @Post('rest/asset/v1/smartCampaign/:id/activate.json')
  @HttpCode(200)
  async activateSmartCampaignUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.smartCampaignsService.activateSmartCampaignUsingPOST(id)
  }

  @Post('rest/asset/v1/smartCampaign/:id/deactivate.json')
  @HttpCode(200)
  async deactivateSmartCampaignUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.smartCampaignsService.deactivateSmartCampaignUsingPOST(id)
  }

  @Post('rest/asset/v1/smartCampaign/:id/clone.json')
  @HttpCode(200)
  async cloneSmartCampaignUsingPOST(
    @Param('id') id: number,
    @Body() cloneSmartCampaignRequest: CloneSmartCampaignRequest,
  ): Promise<ResponseOfSmartCampaignResponse> {
    return this.smartCampaignsService.cloneSmartCampaignUsingPOST(
      id,
      cloneSmartCampaignRequest,
    )
  }

  @Post('rest/asset/v1/smartCampaign/:id/delete.json')
  @HttpCode(200)
  async deleteSmartCampaignUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.smartCampaignsService.deleteSmartCampaignUsingPOST(id)
  }
}
