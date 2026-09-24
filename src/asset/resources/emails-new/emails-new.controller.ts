import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { EmailsNewService } from './emails-new.service'

import type { BulkDeleteRequest } from '../../../asset-definitions/requests/bulk-delete-request'
import type { BulkGetRequest } from '../../../asset-definitions/requests/bulk-get-request'
import type { BulkUsedByRequest } from '../../../asset-definitions/requests/bulk-used-by-request'
import type { BulkUsedByResponse } from '../../../asset-definitions/responses/bulk-used-by-response'
import type { CloneAssetRequest } from '../../../asset-definitions/requests/clone-asset-request'
import type { CreateEmailV2Request } from '../../../asset-definitions/requests/create-email-v2-request'
import type { DeleteResponse } from '../../../asset-definitions/responses/delete-response'
import type { EmailFilterResponse } from '../../../asset-definitions/responses/email-filter-response'
import type { EmailNewResponse } from '../../../asset-definitions/responses/email-new-response'
import type { StateTransitionRequest } from '../../../asset-definitions/requests/state-transition-request'
import type { UpdateEmailRequest } from '../../../asset-definitions/requests/update-email-request'
import type { UsedByRequestDto } from '../../../asset-definitions/models/used-by-request-dto'
import type { UsedByResponse } from '../../../asset-definitions/responses/used-by-response'

@Controller()
export class EmailsNewController {
  constructor(private readonly emailsNewService: EmailsNewService) {}

  @Post('rest/asset/v2/email')
  async createContentUsingPOST_email(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() createEmailRequest: CreateEmailV2Request,
  ): Promise<EmailNewResponse> {
    return this.emailsNewService.createContentUsingPOST_email(
      accessToken,
      xAppType,
      createEmailRequest,
    )
  }

  @Post('rest/asset/v2/email/clone')
  async cloneContentUsingPOST_email(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() cloneAssetRequest: CloneAssetRequest,
  ): Promise<EmailNewResponse> {
    return this.emailsNewService.cloneContentUsingPOST_email(
      accessToken,
      xAppType,
      cloneAssetRequest,
    )
  }

  @Get('rest/asset/v2/email/filter')
  async filterContentUsingGET_email(
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
    @Query('templateId') templateId?: string,
    @Query('scriptEngine') scriptEngine?: string,
    @Query('isValueNonNullable') isValueNonNullable?: string,
    @Query('includeArchived') includeArchived?: boolean,
  ): Promise<EmailFilterResponse> {
    return this.emailsNewService.filterContentUsingGET_email(
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
      templateId,
      scriptEngine,
      isValueNonNullable,
      includeArchived,
    )
  }

  @Post('rest/asset/v2/email/state/transition')
  async stateTransitionUsingPOST_email(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() stateTransitionRequest: StateTransitionRequest,
  ): Promise<EmailNewResponse> {
    return this.emailsNewService.stateTransitionUsingPOST_email(
      accessToken,
      xAppType,
      stateTransitionRequest,
    )
  }

  @Post('rest/asset/v2/email/usedby')
  async getContentUsedByUsingPOST_email(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() usedByRequest: UsedByRequestDto,
  ): Promise<UsedByResponse> {
    return this.emailsNewService.getContentUsedByUsingPOST_email(
      accessToken,
      xAppType,
      usedByRequest,
    )
  }

  @Get('rest/asset/v2/email/:id')
  async getContentUsingGET_email(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Param('id') id: string,
  ): Promise<EmailNewResponse> {
    return this.emailsNewService.getContentUsingGET_email(
      accessToken,
      xAppType,
      id,
    )
  }

  @Post('rest/asset/v2/email/:id/delete')
  async deleteContentUsingPOST_email(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Param('id') id: string,
  ): Promise<DeleteResponse> {
    return this.emailsNewService.deleteContentUsingPOST_email(
      accessToken,
      xAppType,
      id,
    )
  }

  @Post('rest/asset/v2/email/:id/update')
  async updateContentUsingPOST_email(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Param('id') id: string,
    @Body() updateEmailRequest?: UpdateEmailRequest,
  ): Promise<EmailNewResponse> {
    return this.emailsNewService.updateContentUsingPOST_email(
      accessToken,
      xAppType,
      id,
      updateEmailRequest,
    )
  }

  @Post('rest/asset/v2/email/bulk/get')
  async bulkGetUsingPOST_email(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: string,
    @Body() bulkGetRequest: BulkGetRequest,
  ): Promise<EmailNewResponse> {
    return this.emailsNewService.bulkGetUsingPOST_email(
      accessToken,
      xAppType,
      bulkGetRequest,
    )
  }

  @Post('rest/asset/v2/email/bulk/delete')
  async bulkDeleteUsingPOST_email(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: string,
    @Body() bulkDeleteRequest: BulkDeleteRequest,
  ): Promise<DeleteResponse> {
    return this.emailsNewService.bulkDeleteUsingPOST_email(
      accessToken,
      xAppType,
      bulkDeleteRequest,
    )
  }

  @Post('rest/asset/v2/email/bulk/usedby')
  async bulkUsedByUsingPOST_email(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: string,
    @Body() bulkUsedByRequest: BulkUsedByRequest,
  ): Promise<BulkUsedByResponse> {
    return this.emailsNewService.bulkUsedByUsingPOST_email(
      accessToken,
      xAppType,
      bulkUsedByRequest,
    )
  }
}
