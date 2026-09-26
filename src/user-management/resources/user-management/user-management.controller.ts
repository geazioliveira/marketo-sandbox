import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { UserManagementService } from './user-management.service'

import type { AddRolesRequest } from '../../user-management-definitions/requests/add-roles-request'
import type { DeleteRolesRequest } from '../../user-management-definitions/requests/delete-roles-request'
import type { InviteUserRequest } from '../../user-management-definitions/requests/invite-user-request'
import type { ResponseOfAllUsers } from '../../user-management-definitions/responses/response-of-all-users'
import type { ResponseOfInvitedUser } from '../../user-management-definitions/responses/response-of-invited-user'
import type { ResponseOfRole } from '../../user-management-definitions/responses/response-of-role'
import type { ResponseOfUser } from '../../user-management-definitions/responses/response-of-user'
import type { ResponseOfWorkspace } from '../../user-management-definitions/responses/response-of-workspace'
import type { UpdateUserAttributesRequest } from '../../user-management-definitions/requests/update-user-attributes-request'
import type { UserRoleWorkspace } from '../../user-management-definitions/models/user-role-workspace'

@Controller()
export class UserManagementController {
  constructor(private readonly userManagementService: UserManagementService) {}

  @Get('userservice/management/v1/users/allusers.json')
  async getUsersUsingGET(
    @Query('pageOffset') pageOffset?: number,
    @Query('pageSize') pageSize?: number,
    @Query('includeRoleWorkspace') includeRoleWorkspace?: boolean,
  ): Promise<Array<ResponseOfAllUsers>> {
    return this.userManagementService.getUsersUsingGET(
      pageOffset,
      pageSize,
      includeRoleWorkspace,
    )
  }

  @Post('userservice/management/v1/users/invite.json')
  @HttpCode(200)
  async inviteUserUsingPOST(
    @Body() inviteUserRequest: InviteUserRequest,
  ): Promise<string> {
    return this.userManagementService.inviteUserUsingPOST(inviteUserRequest)
  }

  @Get('userservice/management/v1/users/roles.json')
  async getRolesUsingGET(): Promise<Array<ResponseOfRole>> {
    return this.userManagementService.getRolesUsingGET()
  }

  @Get('userservice/management/v1/users/workspaces.json')
  async getWorkspacesUsingGET(): Promise<Array<ResponseOfWorkspace>> {
    return this.userManagementService.getWorkspacesUsingGET()
  }

  @Post('userservice/management/v1/users/:userid/delete.json')
  @HttpCode(200)
  async deleteUserUsingPOST(@Param('userid') userid: string): Promise<void> {
    return this.userManagementService.deleteUserUsingPOST(userid)
  }

  @Post('userservice/management/v1/users/:userid/invite/delete.json')
  @HttpCode(200)
  async deleteInvitedUserUsingPOST(
    @Param('userid') userid: string,
  ): Promise<void> {
    return this.userManagementService.deleteInvitedUserUsingPOST(userid)
  }

  @Post('userservice/management/v1/users/:userid/update.json')
  @HttpCode(200)
  async updateUserAttributeUsingPOST(
    @Body() updateUserAttributesRequest: UpdateUserAttributesRequest,
    @Param('userid') userid: string,
  ): Promise<ResponseOfUser> {
    return this.userManagementService.updateUserAttributeUsingPOST(
      updateUserAttributesRequest,
      userid,
    )
  }

  @Get('userservice/management/v1/users/:userid/roles.json')
  async getUserRolesAndWorkspacesUsingGET(
    @Param('userid') userid: string,
  ): Promise<Array<UserRoleWorkspace>> {
    return this.userManagementService.getUserRolesAndWorkspacesUsingGET(userid)
  }

  @Post('userservice/management/v1/users/:userid/roles/create.json')
  @HttpCode(200)
  async addRolesUsingPOST(
    @Body() addRolesRequest: AddRolesRequest,
    @Param('userid') userid: string,
  ): Promise<Array<UserRoleWorkspace>> {
    return this.userManagementService.addRolesUsingPOST(addRolesRequest, userid)
  }

  @Post('userservice/management/v1/users/:userid/roles/delete.json')
  @HttpCode(200)
  async deleteRolesUsingPOST(
    @Body() deleteRolesRequest: DeleteRolesRequest,
    @Param('userid') userid: string,
  ): Promise<Array<UserRoleWorkspace>> {
    return this.userManagementService.deleteRolesUsingPOST(
      deleteRolesRequest,
      userid,
    )
  }

  @Get('userservice/management/v1/users/:userid/user.json')
  async getUserUsingGET(
    @Param('userid') userid: string,
  ): Promise<ResponseOfUser> {
    return this.userManagementService.getUserUsingGET(userid)
  }

  @Get('userservice/management/v1/users/:userid/invite.json')
  async getInvitedUserUsingGET(
    @Param('userid') userid: string,
  ): Promise<ResponseOfInvitedUser> {
    return this.userManagementService.getInvitedUserUsingGET(userid)
  }
}
