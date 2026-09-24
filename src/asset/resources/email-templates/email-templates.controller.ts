import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { EmailTemplatesService } from './email-templates.service'

import type { CloneEmailTemplateRequest } from '../../asset-definitions/requests/clone-email-template-request'
import type { CreateEmailTemplateRequest } from '../../asset-definitions/requests/create-email-template-request'
import type { ResponseOfEmailTemplateContentResponse } from '../../asset-definitions/responses/response-of-email-template-content-response'
import type { ResponseOfEmailTemplateResponse } from '../../asset-definitions/responses/response-of-email-template-response'
import type { ResponseOfEmailTemplateUsedByResponse } from '../../asset-definitions/responses/response-of-email-template-used-by-response'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { UpdateEmailTemplateContentRequest } from '../../asset-definitions/requests/update-email-template-content-request'
import type { UpdateEmailTemplateMetaDataRequest } from '../../asset-definitions/requests/update-email-template-meta-data-request'

@Controller()
export class EmailTemplatesController {
  constructor(private readonly emailTemplatesService: EmailTemplatesService) {}

  @Get('rest/asset/v1/emailTemplate/byName.json')
  async getTemplateByNameUsingGET(
    @Query('name') name: string,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfEmailTemplateResponse> {
    return this.emailTemplatesService.getTemplateByNameUsingGET(name, status)
  }

  @Get('rest/asset/v1/emailTemplate/:id.json')
  async getTemplateByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfEmailTemplateResponse> {
    return this.emailTemplatesService.getTemplateByIdUsingGET(id, status)
  }

  @Post('rest/asset/v1/emailTemplate/:id.json')
  async updateEmailTemplateUsingPOST(
    @Param('id') id: number,
    @Body() updateEmailMetaDataRequest: UpdateEmailTemplateMetaDataRequest,
  ): Promise<ResponseOfEmailTemplateResponse> {
    return this.emailTemplatesService.updateEmailTemplateUsingPOST(
      id,
      updateEmailMetaDataRequest,
    )
  }

  @Post('rest/asset/v1/emailTemplate/:id/approveDraft.json')
  async approveDraftUsingPOST_1(
    @Param('id') id: number,
  ): Promise<ResponseOfEmailTemplateResponse> {
    return this.emailTemplatesService.approveDraftUsingPOST_1(id)
  }

  @Post('rest/asset/v1/emailTemplate/:id/clone.json')
  async cloneTemplateUsingPOST(
    @Param('id') id: number,
    @Body() cloneEmailTemplateRequest: CloneEmailTemplateRequest,
  ): Promise<ResponseOfEmailTemplateResponse> {
    return this.emailTemplatesService.cloneTemplateUsingPOST(
      id,
      cloneEmailTemplateRequest,
    )
  }

  @Get('rest/asset/v1/emailTemplate/:id/content')
  async getTemplateContentByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfEmailTemplateContentResponse> {
    return this.emailTemplatesService.getTemplateContentByIdUsingGET(id, status)
  }

  @Post('rest/asset/v1/emailTemplate/:id/content.json')
  async updateEmailTemplateContentUsingPOST(
    @Param('id') id: number,
    @Body()
    updateEmailTemplateContentRequest?: UpdateEmailTemplateContentRequest,
  ): Promise<ResponseOfIdResponse> {
    return this.emailTemplatesService.updateEmailTemplateContentUsingPOST(
      id,
      updateEmailTemplateContentRequest,
    )
  }

  @Post('rest/asset/v1/emailTemplate/:id/delete.json')
  async deleteTemplateUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.emailTemplatesService.deleteTemplateUsingPOST(id)
  }

  @Post('rest/asset/v1/emailTemplate/:id/discardDraft.json')
  async discardDraftUsingPOST_1(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.emailTemplatesService.discardDraftUsingPOST_1(id)
  }

  @Post('rest/asset/v1/emailTemplate/:id/unapprove.json')
  async unapproveDraftUsingPOST_1(
    @Param('id') id: number,
  ): Promise<ResponseOfEmailTemplateResponse> {
    return this.emailTemplatesService.unapproveDraftUsingPOST_1(id)
  }

  @Get('rest/asset/v1/emailTemplates.json')
  async getEmailTemplatesUsingGET(
    @Query('offset') offset?: number,
    @Query('maxReturn') maxReturn?: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfEmailTemplateResponse> {
    return this.emailTemplatesService.getEmailTemplatesUsingGET(
      offset,
      maxReturn,
      status,
    )
  }

  @Post('rest/asset/v1/emailTemplates.json')
  async createEmailTemplateUsingPOST(
    @Body() createEmailTemplateRequest: CreateEmailTemplateRequest,
  ): Promise<ResponseOfEmailTemplateResponse> {
    return this.emailTemplatesService.createEmailTemplateUsingPOST(
      createEmailTemplateRequest,
    )
  }

  @Get('rest/asset/v1/emailTemplates/:id/usedBy.json')
  async getEmailTemplateUsedByUsingGET(
    @Param('id') id: number,
    @Query('offset') offset?: number,
    @Query('maxReturn') maxReturn?: number,
  ): Promise<ResponseOfEmailTemplateUsedByResponse> {
    return this.emailTemplatesService.getEmailTemplateUsedByUsingGET(
      id,
      offset,
      maxReturn,
    )
  }
}
