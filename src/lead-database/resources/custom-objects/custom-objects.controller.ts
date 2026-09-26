import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { CustomObjectsService } from './custom-objects.service'

import type { AddCustomObjectTypeFieldsRequest } from '../../lead-database-definitions/requests/add-custom-object-type-fields-request'
import type { DeleteCustomObjectRequest } from '../../lead-database-definitions/requests/delete-custom-object-request'
import type { DeleteCustomObjectTypeFieldsRequest } from '../../lead-database-definitions/requests/delete-custom-object-type-fields-request'
import type { LookupCustomObjectRequest } from '../../lead-database-definitions/requests/lookup-custom-object-request'
import type { ResponseOfCustomObject } from '../../lead-database-definitions/responses/response-of-custom-object'
import type { ResponseOfCustomObjectType } from '../../lead-database-definitions/responses/response-of-custom-object-type'
import type { ResponseOfCustomObjectTypeFieldDataTypes } from '../../lead-database-definitions/responses/response-of-custom-object-type-field-data-types'
import type { ResponseOfObjectDependentAssets } from '../../lead-database-definitions/responses/response-of-object-dependent-assets'
import type { ResponseOfObjectLinkableObject } from '../../lead-database-definitions/responses/response-of-object-linkable-object'
import type { ResponseOfObjectMetaData } from '../../lead-database-definitions/responses/response-of-object-meta-data'
import type { SyncCustomObjectRequest } from '../../lead-database-definitions/requests/sync-custom-object-request'
import type { SyncCustomObjectTypeRequest } from '../../lead-database-definitions/requests/sync-custom-object-type-request'
import type { UpdateCustomObjectTypeFieldRequest } from '../../lead-database-definitions/requests/update-custom-object-type-field-request'

@Controller()
export class CustomObjectsController {
  constructor(private readonly customObjectsService: CustomObjectsService) {}

  @Get('rest/v1/customobjects.json')
  async listCustomObjectsUsingGET(
    @Query('names') names?: Array<string>,
  ): Promise<ResponseOfObjectMetaData> {
    return this.customObjectsService.listCustomObjectsUsingGET(names)
  }

  @Get('rest/v1/customobjects/schema.json')
  async listCustomObjectTypesUsingGET(
    @Query('names') names?: Array<string>,
    @Query('state') state?: 'draft' | 'approved' | 'approvedWithDraft',
  ): Promise<ResponseOfObjectMetaData> {
    return this.customObjectsService.listCustomObjectTypesUsingGET(names, state)
  }

  @Get('rest/v1/customobjects/:customObjectName.json')
  async getCustomObjectsUsingGET(
    @Param('customObjectName') customObjectName: string,
    @Query('filterType') filterType: string,
    @Query('filterValues') filterValues: Array<string>,
    @Body() customObjectLookupRequest?: LookupCustomObjectRequest,
    @Query('fields') fields?: Array<string>,
    @Query('batchSize') batchSize?: number,
    @Query('nextPageToken') nextPageToken?: string,
  ): Promise<ResponseOfCustomObject> {
    return this.customObjectsService.getCustomObjectsUsingGET(
      customObjectName,
      filterType,
      filterValues,
      customObjectLookupRequest,
      fields,
      batchSize,
      nextPageToken,
    )
  }

  @Post('rest/v1/customobjects/schema.json')
  @HttpCode(200)
  async syncCustomObjectTypeUsingPOST(
    @Body() syncCustomObjectTypeRequest: SyncCustomObjectTypeRequest,
  ): Promise<ResponseOfCustomObjectType> {
    return this.customObjectsService.syncCustomObjectTypeUsingPOST(
      syncCustomObjectTypeRequest,
    )
  }

  @Post('rest/v1/customobjects/:customObjectName.json')
  @HttpCode(200)
  async syncCustomObjectsUsingPOST(
    @Param('customObjectName') customObjectName: string,
    @Body() syncCustomObjectRequest: SyncCustomObjectRequest,
  ): Promise<ResponseOfCustomObject> {
    return this.customObjectsService.syncCustomObjectsUsingPOST(
      customObjectName,
      syncCustomObjectRequest,
    )
  }

  @Post('rest/v1/customobjects/:customObjectName/delete.json')
  @HttpCode(200)
  async deleteCustomObjectsUsingPOST(
    @Param('customObjectName') customObjectName: string,
    @Body() deleteCustomObjectRequest?: DeleteCustomObjectRequest,
  ): Promise<ResponseOfCustomObject> {
    return this.customObjectsService.deleteCustomObjectsUsingPOST(
      customObjectName,
      deleteCustomObjectRequest,
    )
  }

  @Get('rest/v1/customobjects/:customObjectName/describe.json')
  async describeUsingGET_1(
    @Param('customObjectName') customObjectName: string,
  ): Promise<ResponseOfObjectMetaData> {
    return this.customObjectsService.describeUsingGET_1(customObjectName)
  }

  @Post('rest/v1/customobjects/schema/:apiName/approve.json')
  @HttpCode(200)
  async approveCustomObjectTypeUsingPOST(
    @Param('apiName') apiName: string,
  ): Promise<ResponseOfCustomObjectType> {
    return this.customObjectsService.approveCustomObjectTypeUsingPOST(apiName)
  }

  @Post('rest/v1/customobjects/schema/:apiName/discardDraft.json')
  @HttpCode(200)
  async discardCustomObjectTypeUsingPOST(
    @Param('apiName') apiName: string,
  ): Promise<ResponseOfCustomObjectType> {
    return this.customObjectsService.discardCustomObjectTypeUsingPOST(apiName)
  }

  @Post('rest/v1/customobjects/schema/:apiName/delete.json')
  @HttpCode(200)
  async deleteCustomObjectTypeUsingPOST(
    @Param('apiName') apiName: string,
  ): Promise<ResponseOfCustomObjectType> {
    return this.customObjectsService.deleteCustomObjectTypeUsingPOST(apiName)
  }

  @Get('rest/v1/customobjects/schema/:apiName/describe.json')
  async describeCustomObjectTypeUsingGET(
    @Param('apiName') apiName: string,
    @Query('state') state?: 'draft' | 'approved' | 'approvedWithDraft',
  ): Promise<ResponseOfObjectMetaData> {
    return this.customObjectsService.describeCustomObjectTypeUsingGET(
      apiName,
      state,
    )
  }

  @Post('rest/v1/customobjects/schema/:apiName/addField.json')
  @HttpCode(200)
  async addCustomObjectTypeFieldsUsingPOST(
    @Param('apiName') apiName: string,
    @Body() addCustomObjectTypeFieldsRequest: AddCustomObjectTypeFieldsRequest,
  ): Promise<ResponseOfCustomObjectType> {
    return this.customObjectsService.addCustomObjectTypeFieldsUsingPOST(
      apiName,
      addCustomObjectTypeFieldsRequest,
    )
  }

  @Post('rest/v1/customobjects/schema/:apiName/deleteField.json')
  @HttpCode(200)
  async deleteCustomObjectTypeFieldsUsingPOST(
    @Param('apiName') apiName: string,
    @Body()
    deleteCustomObjectTypeFieldsRequest: DeleteCustomObjectTypeFieldsRequest,
  ): Promise<ResponseOfCustomObjectType> {
    return this.customObjectsService.deleteCustomObjectTypeFieldsUsingPOST(
      apiName,
      deleteCustomObjectTypeFieldsRequest,
    )
  }

  @Post('rest/v1/customobjects/schema/:apiName/:fieldApiName/updateField.json')
  @HttpCode(200)
  async updateCustomObjectTypeFieldUsingPOST(
    @Param('apiName') apiName: string,
    @Param('fieldApiName') fieldApiName: string,
    @Body()
    updateCustomObjectTypeFieldRequest: UpdateCustomObjectTypeFieldRequest,
  ): Promise<ResponseOfCustomObjectType> {
    return this.customObjectsService.updateCustomObjectTypeFieldUsingPOST(
      apiName,
      fieldApiName,
      updateCustomObjectTypeFieldRequest,
    )
  }

  @Get('rest/v1/customobjects/schema/fieldDataTypes.json')
  async getCustomObjectTypeFieldDataTypesUsingGET(): Promise<ResponseOfCustomObjectTypeFieldDataTypes> {
    return this.customObjectsService.getCustomObjectTypeFieldDataTypesUsingGET()
  }

  @Get('rest/v1/customobjects/schema/linkableObjects.json')
  async getCustomObjectTypeLinkableObjectsUsingGET(): Promise<ResponseOfObjectLinkableObject> {
    return this.customObjectsService.getCustomObjectTypeLinkableObjectsUsingGET()
  }

  @Get('rest/v1/customobjects/schema/:apiName/dependentAssets.json')
  async getCustomObjectTypeDependentAssetsUsingGET(
    @Param('apiName') apiName: string,
  ): Promise<ResponseOfObjectDependentAssets> {
    return this.customObjectsService.getCustomObjectTypeDependentAssetsUsingGET(
      apiName,
    )
  }
}
