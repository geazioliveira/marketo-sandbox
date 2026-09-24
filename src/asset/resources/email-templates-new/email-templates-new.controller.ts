import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { EmailTemplatesNewService } from './email-templates-new.service'

import type { BulkDeleteRequest } from '../../asset-definitions/requests/bulk-delete-request'
import type { BulkGetRequest } from '../../asset-definitions/requests/bulk-get-request'
import type { BulkUsedByRequest } from '../../asset-definitions/requests/bulk-used-by-request'
import type { BulkUsedByResponse } from '../../asset-definitions/responses/bulk-used-by-response'
import type { CloneAssetRequest } from '../../asset-definitions/requests/clone-asset-request'
import type { CreateEmailTemplateV2Request } from '../../asset-definitions/requests/create-email-template-v2-request'
import type { DeleteResponse } from '../../asset-definitions/responses/delete-response'
import type { EmailTemplateFilterResponse } from '../../asset-definitions/responses/email-template-filter-response'
import type { EmailTemplateNewResponse } from '../../asset-definitions/responses/email-template-new-response'
import type { StateTransitionRequest } from '../../asset-definitions/requests/state-transition-request'
import type { UpdateEmailTemplateRequest } from '../../asset-definitions/requests/update-email-template-request'
import type { UsedByRequestDto } from '../../asset-definitions/models/used-by-request-dto'
import type { UsedByResponse } from '../../asset-definitions/responses/used-by-response'

@Controller()
export class EmailTemplatesNewController {
  constructor(
    private readonly emailTemplatesNewService: EmailTemplatesNewService,
  ) {}

  @Post('rest/asset/v2/emailtemplate')
  async createContentUsingPOST_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() createEmailTemplateRequest: CreateEmailTemplateV2Request,
  ): Promise<EmailTemplateNewResponse> {
    return this.emailTemplatesNewService.createContentUsingPOST_emailtemplate(
      accessToken,
      xAppType,
      createEmailTemplateRequest,
    )
  }

  @Post('rest/asset/v2/emailtemplate/clone')
  async cloneContentUsingPOST_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() cloneAssetRequest: CloneAssetRequest,
  ): Promise<EmailTemplateNewResponse> {
    return this.emailTemplatesNewService.cloneContentUsingPOST_emailtemplate(
      accessToken,
      xAppType,
      cloneAssetRequest,
    )
  }

  @Get('rest/asset/v2/emailtemplate/filter')
  async filterContentUsingGET_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Query('workspaceId') workspaceId: string,
    @Query('folderId') folderId?: string,
    @Query('folderType') folderType?: 'Folder' | 'Program',
    @Query('status') status?: Array<string>,
    @Query('pageIndex') pageIndex?: number,
    @Query('pageSize') pageSize?: number,
    @Query('createdAtEnd') createdAtEnd?: string,
    @Query('createdAtStart') createdAtStart?: string,
    @Query('modifiedAtStart') modifiedAtStart?: string,
    @Query('modifiedAtEnd') modifiedAtEnd?: string,
    @Query('name') name?: string,
    @Query('sortKey') sortKey?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
    @Query('isCreatedByMe') isCreatedByMe?: boolean,
    @Query('isModifiedByMe') isModifiedByMe?: boolean,
    @Query('scriptEngine') scriptEngine?: string,
    @Query('isValueNonNullable') isValueNonNullable?: string,
    @Query('includeArchived') includeArchived?: boolean,
  ): Promise<EmailTemplateFilterResponse> {
    return this.emailTemplatesNewService.filterContentUsingGET_emailtemplate(
      accessToken,
      xAppType,
      workspaceId,
      folderId,
      folderType,
      status,
      pageIndex,
      pageSize,
      createdAtEnd,
      createdAtStart,
      modifiedAtStart,
      modifiedAtEnd,
      name,
      sortKey,
      sortOrder,
      isCreatedByMe,
      isModifiedByMe,
      scriptEngine,
      isValueNonNullable,
      includeArchived,
    )
  }

  @Post('rest/asset/v2/emailtemplate/state/transition')
  async stateTransitionUsingPOST_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() stateTransitionRequest: StateTransitionRequest,
  ): Promise<EmailTemplateNewResponse> {
    return this.emailTemplatesNewService.stateTransitionUsingPOST_emailtemplate(
      accessToken,
      xAppType,
      stateTransitionRequest,
    )
  }

  @Post('rest/asset/v2/emailtemplate/usedby')
  async getContentUsedByUsingPOST_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() usedByRequest: UsedByRequestDto,
  ): Promise<UsedByResponse> {
    return this.emailTemplatesNewService.getContentUsedByUsingPOST_emailtemplate(
      accessToken,
      xAppType,
      usedByRequest,
    )
  }

  @Get('rest/asset/v2/emailtemplate/:id')
  async getContentUsingGET_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Param('id') id: string,
  ): Promise<EmailTemplateNewResponse> {
    return this.emailTemplatesNewService.getContentUsingGET_emailtemplate(
      accessToken,
      xAppType,
      id,
    )
  }

  @Post('rest/asset/v2/emailtemplate/:id/delete')
  async deleteContentUsingPOST_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Param('id') id: string,
  ): Promise<DeleteResponse> {
    return this.emailTemplatesNewService.deleteContentUsingPOST_emailtemplate(
      accessToken,
      xAppType,
      id,
    )
  }

  @Post('rest/asset/v2/emailtemplate/:id/update')
  async updateContentUsingPOST_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Param('id') id: string,
    @Body() updateEmailTemplateRequest?: UpdateEmailTemplateRequest,
  ): Promise<EmailTemplateNewResponse> {
    return this.emailTemplatesNewService.updateContentUsingPOST_emailtemplate(
      accessToken,
      xAppType,
      id,
      updateEmailTemplateRequest,
    )
  }

  @Post('rest/asset/v2/emailtemplate/bulk/get')
  async bulkGetUsingPOST_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: string,
    @Body() bulkGetRequest: BulkGetRequest,
  ): Promise<EmailTemplateNewResponse> {
    return this.emailTemplatesNewService.bulkGetUsingPOST_emailtemplate(
      accessToken,
      xAppType,
      bulkGetRequest,
    )
  }

  @Post('rest/asset/v2/emailtemplate/bulk/delete')
  async bulkDeleteUsingPOST_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: string,
    @Body() bulkDeleteRequest: BulkDeleteRequest,
  ): Promise<DeleteResponse> {
    return this.emailTemplatesNewService.bulkDeleteUsingPOST_emailtemplate(
      accessToken,
      xAppType,
      bulkDeleteRequest,
    )
  }

  @Post('rest/asset/v2/emailtemplate/bulk/usedby')
  async bulkUsedByUsingPOST_emailtemplate(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: string,
    @Body() bulkUsedByRequest: BulkUsedByRequest,
  ): Promise<BulkUsedByResponse> {
    return this.emailTemplatesNewService.bulkUsedByUsingPOST_emailtemplate(
      accessToken,
      xAppType,
      bulkUsedByRequest,
    )
  }
}
