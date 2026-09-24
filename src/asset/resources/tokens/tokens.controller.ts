import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { TokensService } from './tokens.service'

import type { CreateTokenRequest } from '../../asset-definitions/requests/create-token-request'
import type { DeleteTokenRequest } from '../../asset-definitions/requests/delete-token-request'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfTokenResponse } from '../../asset-definitions/responses/response-of-token-response'

@Controller()
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get('rest/asset/v1/folder/:id/tokens.json')
  async getTokensByFolderIdUsingGET(
    @Param('id') id: number,
    @Query('folderType') folderType?: 'Folder' | 'Program',
  ): Promise<ResponseOfTokenResponse> {
    return this.tokensService.getTokensByFolderIdUsingGET(id, folderType)
  }

  @Post('rest/asset/v1/folder/:id/tokens.json')
  async addTokenTOFolderUsingPOST(
    @Param('id') id: number,
    @Body() createTokenRequest: CreateTokenRequest,
  ): Promise<ResponseOfTokenResponse> {
    return this.tokensService.addTokenTOFolderUsingPOST(id, createTokenRequest)
  }

  @Post('rest/asset/v1/folder/:id/tokens/delete.json')
  async deleteTokenByNameUsingPOST(
    @Param('id') id: number,
    @Body() deleteTokenRequest: DeleteTokenRequest,
  ): Promise<ResponseOfIdResponse> {
    return this.tokensService.deleteTokenByNameUsingPOST(id, deleteTokenRequest)
  }
}
