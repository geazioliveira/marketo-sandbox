import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { EmailsService } from './emails.service'

import type { CloneEmailRequest } from '../../../asset-definitions/requests/clone-email-request'
import type { CreateEmailRequest } from '../../../asset-definitions/requests/create-email-request'
import type { ResponseOfEmailCCFieldsResponse } from '../../../asset-definitions/responses/response-of-email-cc-fields-response'
import type { ResponseOfEmailContentResponse } from '../../../asset-definitions/responses/response-of-email-content-response'
import type { ResponseOfEmailDynamicContentResponse } from '../../../asset-definitions/responses/response-of-email-dynamic-content-response'
import type { ResponseOfEmailModuleResponse } from '../../../asset-definitions/responses/response-of-email-module-response'
import type { ResponseOfEmailResponse } from '../../../asset-definitions/responses/response-of-email-response'
import type { ResponseOfEmailVariableResponse } from '../../../asset-definitions/responses/response-of-email-variable-response'
import type { ResponseOfGetEmailFullContentResponse } from '../../../asset-definitions/responses/response-of-get-email-full-content-response'
import type { ResponseOfIdResponse } from '../../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfSendSampleResponse } from '../../../asset-definitions/responses/response-of-send-sample-response'
import type { ResponseOfUpdateEmailFullContentResponse } from '../../../asset-definitions/responses/response-of-update-email-full-content-response'
import type { SendSampleEmailRequest } from '../../../asset-definitions/requests/send-sample-email-request'
import type { UpdateEmailComponentContentRequest } from '../../../asset-definitions/requests/update-email-component-content-request'
import type { UpdateEmailComponentDataRequest } from '../../../asset-definitions/requests/update-email-component-data-request'
import type { UpdateEmailDynamicContentRequest } from '../../../asset-definitions/requests/update-email-dynamic-content-request'
import type { UpdateEmailFullContentRequest } from '../../../asset-definitions/requests/update-email-full-content-request'
import type { UpdateEmailMetaDataRequest } from '../../../asset-definitions/requests/update-email-meta-data-request'
import type { UpdateVariableRequest } from '../../../asset-definitions/requests/update-variable-request'

@Controller()
export class EmailsController {
  constructor(private readonly emailsService: EmailsService) {}

  @Get('rest/asset/v1/email/byName.json')
  async getEmailByNameUsingGET(
    @Query('name') name: string,
    @Query('status') status?: 'approved' | 'draft',
    @Query('folder') folder?: string,
  ): Promise<ResponseOfEmailResponse> {
    return this.emailsService.getEmailByNameUsingGET(name, status, folder)
  }

  @Get('rest/asset/v1/email/:id.json')
  async getEmailByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfEmailResponse> {
    return this.emailsService.getEmailByIdUsingGET(id, status)
  }

  @Post('rest/asset/v1/email/:id.json')
  async updateEmailUsingPOST(
    @Param('id') id: number,
    @Body() updateEmailRequest: UpdateEmailMetaDataRequest,
  ): Promise<ResponseOfEmailResponse> {
    return this.emailsService.updateEmailUsingPOST(id, updateEmailRequest)
  }

  @Post('rest/asset/v1/email/:id/approveDraft.json')
  async approveDraftUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.emailsService.approveDraftUsingPOST(id)
  }

  @Post('rest/asset/v1/email/:id/clone.json')
  async cloneEmailUsingPOST(
    @Param('id') id: number,
    @Body() cloneEmailRequest: CloneEmailRequest,
  ): Promise<ResponseOfEmailResponse> {
    return this.emailsService.cloneEmailUsingPOST(id, cloneEmailRequest)
  }

  @Get('rest/asset/v1/email/:id/content.json')
  async getEmailContentByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfEmailContentResponse> {
    return this.emailsService.getEmailContentByIdUsingGET(id, status)
  }

  @Post('rest/asset/v1/email/:id/content.json')
  async updateEmailContentUsingPOST(
    @Param('id') id: number,
    @Body() updateEmailRequest: UpdateEmailComponentDataRequest,
  ): Promise<ResponseOfIdResponse> {
    return this.emailsService.updateEmailContentUsingPOST(
      id,
      updateEmailRequest,
    )
  }

  @Post('rest/asset/v1/email/:id/content/rearrange.json')
  async rearrangeModulesUsingPOST(
    @Param('id') id: number,
    @Body() positions?: string,
  ): Promise<ResponseOfEmailModuleResponse> {
    return this.emailsService.rearrangeModulesUsingPOST(id, positions)
  }

  @Post('rest/asset/v1/email/:id/content/:htmlId.json')
  async updateEmailComponentContentUsingPOST(
    @Param('id') id: number,
    @Param('htmlId') htmlId: string,
    @Body() request: UpdateEmailComponentContentRequest,
  ): Promise<ResponseOfIdResponse> {
    return this.emailsService.updateEmailComponentContentUsingPOST(
      id,
      htmlId,
      request,
    )
  }

  @Post('rest/asset/v1/email/:id/content/:moduleId/add.json')
  async addModuleUsingPOST(
    @Param('id') id: number,
    @Param('moduleId') moduleId: string,
    @Query('name') name: string,
    @Query('index') index: number,
  ): Promise<ResponseOfEmailModuleResponse> {
    return this.emailsService.addModuleUsingPOST(id, moduleId, name, index)
  }

  @Post('rest/asset/v1/email/:id/content/:moduleId/delete.json')
  async deleteModuleUsingPOST(
    @Param('id') id: number,
    @Param('moduleId') moduleId: string,
  ): Promise<ResponseOfEmailModuleResponse> {
    return this.emailsService.deleteModuleUsingPOST(id, moduleId)
  }

  @Post('rest/asset/v1/email/:id/content/:moduleId/duplicate.json')
  async duplicateModuleUsingPOST(
    @Param('id') id: number,
    @Param('moduleId') moduleId: string,
    @Query('name') name: string,
  ): Promise<ResponseOfEmailModuleResponse> {
    return this.emailsService.duplicateModuleUsingPOST(id, moduleId, name)
  }

  @Post('rest/asset/v1/email/:id/content/:moduleId/rename.json')
  async renameUsingPOST(
    @Param('id') id: number,
    @Param('moduleId') moduleId: string,
    @Query('name') name: string,
  ): Promise<ResponseOfEmailModuleResponse> {
    return this.emailsService.renameUsingPOST(id, moduleId, name)
  }

  @Post('rest/asset/v1/email/:id/delete.json')
  async deleteEmailUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.emailsService.deleteEmailUsingPOST(id)
  }

  @Post('rest/asset/v1/email/:id/discardDraft.json')
  async discardDraftUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.emailsService.discardDraftUsingPOST(id)
  }

  @Get('rest/asset/v1/email/:id/dynamicContent/:contentId.json')
  async getEmailDynamicContentUsingGET(
    @Param('id') id: number,
    @Param('contentId') contentId: string,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfEmailDynamicContentResponse> {
    return this.emailsService.getEmailDynamicContentUsingGET(
      id,
      contentId,
      status,
    )
  }

  @Post('rest/asset/v1/email/:id/dynamicContent/:contentId.json')
  async updateEmailDynamicContentUsingPOST(
    @Param('id') id: number,
    @Param('contentId') contentId: string,
    @Body() request: UpdateEmailDynamicContentRequest,
  ): Promise<ResponseOfIdResponse> {
    return this.emailsService.updateEmailDynamicContentUsingPOST(
      id,
      contentId,
      request,
    )
  }

  @Post('rest/asset/v1/email/:id/sendSample.json')
  async sendSampleEmailUsingPOST(
    @Param('id') id: number,
    @Body() sendSampleEmailRequest: SendSampleEmailRequest,
  ): Promise<ResponseOfSendSampleResponse> {
    return this.emailsService.sendSampleEmailUsingPOST(
      id,
      sendSampleEmailRequest,
    )
  }

  @Post('rest/asset/v1/email/:id/unapprove.json')
  async unapproveDraftUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.emailsService.unapproveDraftUsingPOST(id)
  }

  @Post('rest/asset/v1/email/:id/variable/:name.json')
  async updateVariableUsingPOST(
    @Param('id') id: number,
    @Param('name') name: string,
    @Body() updateVariableRequest?: UpdateVariableRequest,
  ): Promise<ResponseOfEmailVariableResponse> {
    return this.emailsService.updateVariableUsingPOST(
      id,
      name,
      updateVariableRequest,
    )
  }

  @Get('rest/asset/v1/email/:id/variables.json')
  async getEmailVariablesUsingGET(
    @Param('id') id: number,
  ): Promise<ResponseOfEmailVariableResponse> {
    return this.emailsService.getEmailVariablesUsingGET(id)
  }

  @Get('rest/asset/v1/email/ccFields.json')
  async getEmailCCFieldsUsingGET(): Promise<ResponseOfEmailCCFieldsResponse> {
    return this.emailsService.getEmailCCFieldsUsingGET()
  }

  @Get('rest/asset/v1/emails.json')
  async getEmailUsingGET(
    @Query('status') status?: 'approved' | 'draft',
    @Query('folder') folder?: string,
    @Query('offset') offset?: number,
    @Query('maxReturn') maxReturn?: number,
    @Query('earliestUpdatedAt') earliestUpdatedAt?: string,
    @Query('latestUpdatedAt') latestUpdatedAt?: string,
  ): Promise<ResponseOfEmailResponse> {
    return this.emailsService.getEmailUsingGET(
      status,
      folder,
      offset,
      maxReturn,
      earliestUpdatedAt,
      latestUpdatedAt,
    )
  }

  @Post('rest/asset/v1/emails.json')
  async createEmailUsingPOST(
    @Body() createEmailRequest: CreateEmailRequest,
  ): Promise<ResponseOfEmailResponse> {
    return this.emailsService.createEmailUsingPOST(createEmailRequest)
  }

  @Get('rest/asset/v1/email/:id/fullContent.json')
  async getEmailFullContentUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
    @Query('leadId') leadId?: number,
    @Query('type') type?: 'Text' | 'HTML',
  ): Promise<ResponseOfGetEmailFullContentResponse> {
    return this.emailsService.getEmailFullContentUsingGET(
      id,
      status,
      leadId,
      type,
    )
  }

  @Post('rest/asset/v1/email/:id/fullContent.json')
  async createEmailFullContentUsingPOST(
    @Param('id') id: number,
    @Body() updateEmailFullContentRequest: UpdateEmailFullContentRequest,
  ): Promise<ResponseOfUpdateEmailFullContentResponse> {
    return this.emailsService.createEmailFullContentUsingPOST(
      id,
      updateEmailFullContentRequest,
    )
  }
}
