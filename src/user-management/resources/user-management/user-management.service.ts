import { Injectable } from '@nestjs/common'
import { faker } from '@faker-js/faker'
import { makeResponseOfAllUsers } from '../../user-management-mocks/factories/response-of-all-users'
import { makeResponseOfInvitedUser } from '../../user-management-mocks/factories/response-of-invited-user'
import { makeResponseOfRole } from '../../user-management-mocks/factories/response-of-role'
import { makeResponseOfUser } from '../../user-management-mocks/factories/response-of-user'
import { makeResponseOfWorkspace } from '../../user-management-mocks/factories/response-of-workspace'
import { makeUserRoleWorkspace } from '../../user-management-mocks/factories/user-role-workspace'

import type { ResponseOfAllUsers } from '../../user-management-definitions/responses/response-of-all-users'
import type { ResponseOfInvitedUser } from '../../user-management-definitions/responses/response-of-invited-user'
import type { ResponseOfRole } from '../../user-management-definitions/responses/response-of-role'
import type { ResponseOfUser } from '../../user-management-definitions/responses/response-of-user'
import type { ResponseOfWorkspace } from '../../user-management-definitions/responses/response-of-workspace'
import type { UserRoleWorkspace } from '../../user-management-definitions/models/user-role-workspace'

@Injectable()
export class UserManagementService {
  async getUsersUsingGET(
    ..._arguments: unknown[]
  ): Promise<Array<ResponseOfAllUsers>> {
    return faker.helpers.multiple(() => makeResponseOfAllUsers(), {
      count: { min: 1, max: 3 },
    })
  }

  async inviteUserUsingPOST(..._arguments: unknown[]): Promise<string> {
    return undefined as never
  }

  async getRolesUsingGET(
    ..._arguments: unknown[]
  ): Promise<Array<ResponseOfRole>> {
    return faker.helpers.multiple(() => makeResponseOfRole(), {
      count: { min: 1, max: 3 },
    })
  }

  async getWorkspacesUsingGET(
    ..._arguments: unknown[]
  ): Promise<Array<ResponseOfWorkspace>> {
    return faker.helpers.multiple(() => makeResponseOfWorkspace(), {
      count: { min: 1, max: 3 },
    })
  }

  async deleteUserUsingPOST(..._arguments: unknown[]): Promise<void> {}

  async deleteInvitedUserUsingPOST(..._arguments: unknown[]): Promise<void> {}

  async updateUserAttributeUsingPOST(
    ..._arguments: unknown[]
  ): Promise<ResponseOfUser> {
    return makeResponseOfUser()
  }

  async getUserRolesAndWorkspacesUsingGET(
    ..._arguments: unknown[]
  ): Promise<Array<UserRoleWorkspace>> {
    return faker.helpers.multiple(() => makeUserRoleWorkspace(), {
      count: { min: 1, max: 3 },
    })
  }

  async addRolesUsingPOST(
    ..._arguments: unknown[]
  ): Promise<Array<UserRoleWorkspace>> {
    return faker.helpers.multiple(() => makeUserRoleWorkspace(), {
      count: { min: 1, max: 3 },
    })
  }

  async deleteRolesUsingPOST(
    ..._arguments: unknown[]
  ): Promise<Array<UserRoleWorkspace>> {
    return faker.helpers.multiple(() => makeUserRoleWorkspace(), {
      count: { min: 1, max: 3 },
    })
  }

  async getUserUsingGET(..._arguments: unknown[]): Promise<ResponseOfUser> {
    return makeResponseOfUser()
  }

  async getInvitedUserUsingGET(
    ..._arguments: unknown[]
  ): Promise<ResponseOfInvitedUser> {
    return makeResponseOfInvitedUser()
  }
}
