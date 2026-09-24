import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ProgramsService } from './programs.service'

import type { CloneProgramRequest } from '../../asset-definitions/requests/clone-program-request'
import type { CreateProgramRequest } from '../../asset-definitions/requests/create-program-request'
import type { ResponseOfBrowseAllPrograms } from '../../asset-definitions/models/response-of-browse-all-programs'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import type { ResponseOfProgramResponse } from '../../asset-definitions/responses/response-of-program-response'
import type { ResponseOfSmartListResponseWithRules } from '../../asset-definitions/models/response-of-smart-list-response-with-rules'
import type { UpdateProgramRequest } from '../../asset-definitions/requests/update-program-request'

@Controller()
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Get('rest/asset/v1/program/byName.json')
  async getProgramByNameUsingGET(
    @Query('name') name: string,
    @Query('includeTags') includeTags?: boolean,
    @Query('includeCosts') includeCosts?: boolean,
  ): Promise<ResponseOfProgramResponse> {
    return this.programsService.getProgramByNameUsingGET(
      name,
      includeTags,
      includeCosts,
    )
  }

  @Get('rest/asset/v1/program/byTag.json')
  async getProgramListByTagUsingGET(
    @Query('tagType') tagType: string,
    @Query('tagValue') tagValue: string,
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
  ): Promise<ResponseOfProgramResponse> {
    return this.programsService.getProgramListByTagUsingGET(
      tagType,
      tagValue,
      maxReturn,
      offset,
    )
  }

  @Get('rest/asset/v1/program/:id.json')
  async getProgramByIdUsingGET(
    @Param('id') id: number,
  ): Promise<ResponseOfProgramResponse> {
    return this.programsService.getProgramByIdUsingGET(id)
  }

  @Post('rest/asset/v1/program/:id.json')
  async updateProgramUsingPOST(
    @Param('id') id: number,
    @Body() updateProgramRequest: UpdateProgramRequest,
  ): Promise<ResponseOfProgramResponse> {
    return this.programsService.updateProgramUsingPOST(id, updateProgramRequest)
  }

  @Get('rest/asset/v1/program/:programId/smartList.json')
  async getSmartListByProgramIdUsingGET(
    @Param('programId') programId: number,
    @Query('includeRules') includeRules?: boolean,
  ): Promise<ResponseOfSmartListResponseWithRules> {
    return this.programsService.getSmartListByProgramIdUsingGET(
      programId,
      includeRules,
    )
  }

  @Post('rest/asset/v1/program/:id/approve.json')
  async approveProgramUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.programsService.approveProgramUsingPOST(id)
  }

  @Post('rest/asset/v1/program/:id/clone.json')
  async cloneProgramUsingPOST(
    @Param('id') id: number,
    @Body() cloneProgramRequest: CloneProgramRequest,
  ): Promise<ResponseOfProgramResponse> {
    return this.programsService.cloneProgramUsingPOST(id, cloneProgramRequest)
  }

  @Post('rest/asset/v1/program/:id/delete.json')
  async deleteProgramUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.programsService.deleteProgramUsingPOST(id)
  }

  @Post('rest/asset/v1/program/:id/unapprove.json')
  async unapproveProgramUsingPOST(
    @Param('id') id: number,
  ): Promise<ResponseOfIdResponse> {
    return this.programsService.unapproveProgramUsingPOST(id)
  }

  @Get('rest/asset/v1/programs.json')
  async browseProgramsUsingGET(
    @Query('maxReturn') maxReturn?: number,
    @Query('offset') offset?: number,
    @Query('filterType')
    filterType?: 'id' | 'programId' | 'folderId' | 'workspace',
    @Query('earliestUpdatedAt') earliestUpdatedAt?: string,
    @Query('latestUpdatedAt') latestUpdatedAt?: string,
  ): Promise<ResponseOfBrowseAllPrograms> {
    return this.programsService.browseProgramsUsingGET(
      maxReturn,
      offset,
      filterType,
      earliestUpdatedAt,
      latestUpdatedAt,
    )
  }

  @Post('rest/asset/v1/programs.json')
  async createProgramUsingPOST(
    @Body() createProgramRequest: CreateProgramRequest,
  ): Promise<ResponseOfProgramResponse> {
    return this.programsService.createProgramUsingPOST(createProgramRequest)
  }
}
