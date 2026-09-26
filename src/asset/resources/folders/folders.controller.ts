import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { FoldersService } from './folders.service'

import type { CreateFolderRequest } from '../../asset-definitions/requests/create-folder-request'
import type { ResponseOfFolderContentResponse } from '../../asset-definitions/responses/response-of-folder-content-response'
import type { ResponseOfFolderResponse } from '../../asset-definitions/responses/response-of-folder-response'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { UpdateFolderRequest } from '../../asset-definitions/requests/update-folder-request'

@Controller()
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Get('rest/asset/v1/folder/byName.json')
  async getFolderByNameUsingGET(
    @Query('name') name: string,
    @Query('type') type?: string,
    @Query('root') root?: string,
    @Query('workSpace') workSpace?: string,
  ): Promise<ResponseOfFolderResponse> {
    return this.foldersService.getFolderByNameUsingGET(
      name,
      type,
      root,
      workSpace,
    )
  }

  @Get('rest/asset/v1/folder/:id.json')
  async getFolderByIdUsingGET(
    @Param('id') id: number,
    @Query('type') type: 'Folder' | 'Program',
  ): Promise<ResponseOfFolderResponse> {
    return this.foldersService.getFolderByIdUsingGET(id, type)
  }

  @Post('rest/asset/v1/folder/:id.json')
  @HttpCode(200)
  async updateFolderUsingPOST(
    @Param('id') id: number,
    @Body() updateFolderRequest: UpdateFolderRequest,
  ): Promise<ResponseOfFolderResponse> {
    return this.foldersService.updateFolderUsingPOST(id, updateFolderRequest)
  }

  @Get('rest/asset/v1/folder/:id/content.json')
  async getFolderContentUsingGET(
    @Param('id') id: number,
    @Query('type') type: 'Folder' | 'Program',
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
  ): Promise<ResponseOfFolderContentResponse> {
    return this.foldersService.getFolderContentUsingGET(
      id,
      type,
      maxReturn,
      offset,
    )
  }

  @Post('rest/asset/v1/folder/:id/delete.json')
  @HttpCode(200)
  async deleteFolderUsingPOST(
    @Param('id') id: number,
    @Body('type') type: 'Program' | 'Folder',
  ): Promise<ResponseOfIdResponse> {
    return this.foldersService.deleteFolderUsingPOST(id, type)
  }

  @Get('rest/asset/v1/folders.json')
  async getFolderUsingGET(
    @Query('root') root?: string,
    @Query('maxDepth') maxDepth?: number,
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
    @Query('workSpace') workSpace?: string,
  ): Promise<ResponseOfFolderResponse> {
    return this.foldersService.getFolderUsingGET(
      root,
      maxDepth,
      maxReturn,
      offset,
      workSpace,
    )
  }

  @Post('rest/asset/v1/folders.json')
  @HttpCode(200)
  async createFolderUsingPOST(
    @Body() createFolderRequest: CreateFolderRequest,
  ): Promise<ResponseOfFolderResponse> {
    return this.foldersService.createFolderUsingPOST(createFolderRequest)
  }
}
