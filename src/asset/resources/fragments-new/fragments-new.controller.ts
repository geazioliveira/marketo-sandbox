import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { FragmentsNewService } from './fragments-new.service'

import type { BulkDeleteRequest } from '../../../asset-definitions/requests/bulk-delete-request'
import type { BulkGetRequest } from '../../../asset-definitions/requests/bulk-get-request'
import type { BulkUsedByRequest } from '../../../asset-definitions/requests/bulk-used-by-request'
import type { BulkUsedByResponse } from '../../../asset-definitions/responses/bulk-used-by-response'
import type { CloneAssetRequest } from '../../../asset-definitions/requests/clone-asset-request'
import type { CreateFragmentRequest } from '../../../asset-definitions/requests/create-fragment-request'
import type { DeleteResponse } from '../../../asset-definitions/responses/delete-response'
import type { FragmentFilterResponse } from '../../../asset-definitions/responses/fragment-filter-response'
import type { FragmentNewResponse } from '../../../asset-definitions/responses/fragment-new-response'
import type { StateTransitionRequest } from '../../../asset-definitions/requests/state-transition-request'
import type { UpdateFragmentRequest } from '../../../asset-definitions/requests/update-fragment-request'
import type { UsedByRequestDto } from '../../../asset-definitions/models/used-by-request-dto'
import type { UsedByResponse } from '../../../asset-definitions/responses/used-by-response'

@Controller()
export class FragmentsNewController {
  constructor(private readonly fragmentsNewService: FragmentsNewService) {}

  @Post('rest/asset/v2/fragment')
  async createContentUsingPOST_fragment(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() createFragmentRequest: CreateFragmentRequest,
  ): Promise<FragmentNewResponse> {
    return this.fragmentsNewService.createContentUsingPOST_fragment(
      accessToken,
      xAppType,
      createFragmentRequest,
    )
  }

  @Post('rest/asset/v2/fragment/clone')
  async cloneContentUsingPOST_fragment(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() cloneAssetRequest: CloneAssetRequest,
  ): Promise<FragmentNewResponse> {
    return this.fragmentsNewService.cloneContentUsingPOST_fragment(
      accessToken,
      xAppType,
      cloneAssetRequest,
    )
  }

  @Get('rest/asset/v2/fragment/filter')
  async filterContentUsingGET_fragment(
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
    @Query('fragmentType') fragmentType?: string,
    @Query('sortKey') sortKey?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
    @Query('isCreatedByMe') isCreatedByMe?: boolean,
    @Query('isModifiedByMe') isModifiedByMe?: boolean,
    @Query('scriptEngine') scriptEngine?: string,
    @Query('isValueNonNullable') isValueNonNullable?: string,
    @Query('includeArchived') includeArchived?: boolean,
  ): Promise<FragmentFilterResponse> {
    return this.fragmentsNewService.filterContentUsingGET_fragment(
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
      fragmentType,
      sortKey,
      sortOrder,
      isCreatedByMe,
      isModifiedByMe,
      scriptEngine,
      isValueNonNullable,
      includeArchived,
    )
  }

  @Post('rest/asset/v2/fragment/state/transition')
  async stateTransitionUsingPOST_fragment(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() stateTransitionRequest: StateTransitionRequest,
  ): Promise<FragmentNewResponse> {
    return this.fragmentsNewService.stateTransitionUsingPOST_fragment(
      accessToken,
      xAppType,
      stateTransitionRequest,
    )
  }

  @Post('rest/asset/v2/fragment/usedby')
  async getContentUsedByUsingPOST_fragment(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Body() usedByRequest: UsedByRequestDto,
  ): Promise<UsedByResponse> {
    return this.fragmentsNewService.getContentUsedByUsingPOST_fragment(
      accessToken,
      xAppType,
      usedByRequest,
    )
  }

  @Get('rest/asset/v2/fragment/:id')
  async getContentUsingGET_fragment(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Param('id') id: string,
  ): Promise<FragmentNewResponse> {
    return this.fragmentsNewService.getContentUsingGET_fragment(
      accessToken,
      xAppType,
      id,
    )
  }

  @Post('rest/asset/v2/fragment/:id/delete')
  async deleteContentUsingPOST_fragment(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Param('id') id: string,
  ): Promise<DeleteResponse> {
    return this.fragmentsNewService.deleteContentUsingPOST_fragment(
      accessToken,
      xAppType,
      id,
    )
  }

  @Post('rest/asset/v2/fragment/:id/update')
  async updateContentUsingPOST_fragment(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: 'marketo',
    @Param('id') id: string,
    @Body() updateFragmentRequest?: UpdateFragmentRequest,
  ): Promise<FragmentNewResponse> {
    return this.fragmentsNewService.updateContentUsingPOST_fragment(
      accessToken,
      xAppType,
      id,
      updateFragmentRequest,
    )
  }

  @Post('rest/asset/v2/fragment/bulk/get')
  async bulkGetUsingPOST_fragment(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: string,
    @Body() bulkGetRequest: BulkGetRequest,
  ): Promise<FragmentNewResponse> {
    return this.fragmentsNewService.bulkGetUsingPOST_fragment(
      accessToken,
      xAppType,
      bulkGetRequest,
    )
  }

  @Post('rest/asset/v2/fragment/bulk/delete')
  async bulkDeleteUsingPOST_fragment(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: string,
    @Body() bulkDeleteRequest: BulkDeleteRequest,
  ): Promise<DeleteResponse> {
    return this.fragmentsNewService.bulkDeleteUsingPOST_fragment(
      accessToken,
      xAppType,
      bulkDeleteRequest,
    )
  }

  @Post('rest/asset/v2/fragment/bulk/usedby')
  async bulkUsedByUsingPOST_fragment(
    @Query('access_token') accessToken: string,
    @Headers('x-app-type') xAppType: string,
    @Body() bulkUsedByRequest: BulkUsedByRequest,
  ): Promise<BulkUsedByResponse> {
    return this.fragmentsNewService.bulkUsedByUsingPOST_fragment(
      accessToken,
      xAppType,
      bulkUsedByRequest,
    )
  }
}
