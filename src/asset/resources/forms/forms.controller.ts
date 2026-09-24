import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { FormsService } from './forms.service'

import type { CloneFormRequest } from '../../asset-definitions/requests/clone-form-request'
import type { CreateLpFormRequest } from '../../asset-definitions/requests/create-lp-form-request'
import type { ResponseOfFormUsedByResponse } from '../../asset-definitions/responses/response-of-form-used-by-response'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfLpFormResponse } from '../../asset-definitions/responses/response-of-lp-form-response'
import type { ResponseOfThankYouPageResponse } from '../../asset-definitions/responses/response-of-thank-you-page-response'
import type { SubmitButtonRequest } from '../../asset-definitions/requests/submit-button-request'
import type { UpdateFormMetaDataRequest } from '../../asset-definitions/requests/update-form-meta-data-request'
import type { UpdateThankYouPageRequest } from '../../asset-definitions/requests/update-thank-you-page-request'

@Controller()
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Get('rest/asset/v1/form/byName.json')
  async getLpFormByNameUsingGET(
    @Query('name') name: string,
    @Query('status') status?: 'approved' | 'draft',
    @Query('folder') folder?: string,
  ): Promise<ResponseOfLpFormResponse> {
    return this.formsService.getLpFormByNameUsingGET(name, status, folder)
  }

  @Get('rest/asset/v1/form/:id.json')
  async getLpFormByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfLpFormResponse> {
    return this.formsService.getLpFormByIdUsingGET(id, status)
  }

  @Post('rest/asset/v1/form/:id.json')
  async updateFormsUsingPOST(
    @Param('id') id: number,
    @Body() updateFormMetaDataRequest: UpdateFormMetaDataRequest,
  ): Promise<ResponseOfLpFormResponse> {
    return this.formsService.updateFormsUsingPOST(id, updateFormMetaDataRequest)
  }

  @Post('rest/asset/v1/form/:id/approveDraft.json')
  async approveFromUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfLpFormResponse> {
    return this.formsService.approveFromUsingPOST(id)
  }

  @Post('rest/asset/v1/form/:id/clone.json')
  async cloneLpFormsUsingPOST(
    @Param('id') id: number,
    @Body() cloneFormRequest?: CloneFormRequest,
  ): Promise<ResponseOfLpFormResponse> {
    return this.formsService.cloneLpFormsUsingPOST(id, cloneFormRequest)
  }

  @Post('rest/asset/v1/form/:id/delete.json')
  async deleteFormByIdUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.formsService.deleteFormByIdUsingPOST(id)
  }

  @Post('rest/asset/v1/form/:id/discardDraft.json')
  async discardFormByIdUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.formsService.discardFormByIdUsingPOST(id)
  }

  @Post('rest/asset/v1/form/:id/submitButton.json')
  async updateFormSubmitButtonUsingPOST(
    @Param('id') id: number,
    @Body() submitButtonRequest: SubmitButtonRequest,
  ): Promise<ResponseOfLpFormResponse> {
    return this.formsService.updateFormSubmitButtonUsingPOST(
      id,
      submitButtonRequest,
    )
  }

  @Get('rest/asset/v1/form/:id/thankYouPage.json')
  async getThankYouPageByIdUsingGET(
    @Param('id') id: number,
    @Query('status') status?: 'approved' | 'draft',
  ): Promise<ResponseOfThankYouPageResponse> {
    return this.formsService.getThankYouPageByIdUsingGET(id, status)
  }

  @Post('rest/asset/v1/form/:id/thankYouPage.json')
  async updateThankYouPageByIdUsingPOST(
    @Param('id') id: number,
    @Body() thankYouPageRequest: UpdateThankYouPageRequest,
  ): Promise<ResponseOfThankYouPageResponse> {
    return this.formsService.updateThankYouPageByIdUsingPOST(
      id,
      thankYouPageRequest,
    )
  }

  @Get('rest/asset/v1/forms.json')
  async browseForms2UsingGET(
    @Query('status') status?: 'approved' | 'draft',
    @Query('folder') folder?: string,
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: string,
  ): Promise<ResponseOfLpFormResponse> {
    return this.formsService.browseForms2UsingGET(
      status,
      folder,
      maxReturn,
      offset,
    )
  }

  @Post('rest/asset/v1/forms.json')
  async createLpFormsUsingPOST(
    @Body() createFormRequest: CreateLpFormRequest,
  ): Promise<ResponseOfLpFormResponse> {
    return this.formsService.createLpFormsUsingPOST(createFormRequest)
  }

  @Get('rest/asset/v1/form/:id/usedBy.json')
  async getFormUsedByUsingGET(
    @Param('id') id: number,
    @Query('offset') offset?: number,
    @Query('maxReturn') maxReturn?: number,
  ): Promise<ResponseOfFormUsedByResponse> {
    return this.formsService.getFormUsedByUsingGET(id, offset, maxReturn)
  }
}
