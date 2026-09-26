import { Injectable } from '@nestjs/common'
import { makeBulkUsedByResponse } from '../../asset-mocks/factories/bulk-used-by-response'
import { makeDeleteResponse } from '../../asset-mocks/factories/delete-response'
import { makeEmailTemplateFilterResponse } from '../../asset-mocks/factories/email-template-filter-response'
import { makeEmailTemplateNewResponse } from '../../asset-mocks/factories/email-template-new-response'
import { makeUsedByResponse } from '../../asset-mocks/factories/used-by-response'

import type { BulkUsedByResponse } from '../../asset-definitions/responses/bulk-used-by-response'
import type { DeleteResponse } from '../../asset-definitions/responses/delete-response'
import type { EmailTemplateFilterResponse } from '../../asset-definitions/responses/email-template-filter-response'
import type { EmailTemplateNewResponse } from '../../asset-definitions/responses/email-template-new-response'
import type { UsedByResponse } from '../../asset-definitions/responses/used-by-response'

@Injectable()
export class EmailTemplatesNewService {
  async createContentUsingPOST_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<EmailTemplateNewResponse> {
    return makeEmailTemplateNewResponse()
  }

  async cloneContentUsingPOST_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<EmailTemplateNewResponse> {
    return makeEmailTemplateNewResponse()
  }

  async filterContentUsingGET_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<EmailTemplateFilterResponse> {
    return makeEmailTemplateFilterResponse()
  }

  async stateTransitionUsingPOST_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<EmailTemplateNewResponse> {
    return makeEmailTemplateNewResponse()
  }

  async getContentUsedByUsingPOST_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<UsedByResponse> {
    return makeUsedByResponse()
  }

  async getContentUsingGET_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<EmailTemplateNewResponse> {
    return makeEmailTemplateNewResponse()
  }

  async bulkDeleteUsingPOST_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<DeleteResponse> {
    return makeDeleteResponse()
  }

  async deleteContentUsingPOST_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<DeleteResponse> {
    return makeDeleteResponse()
  }

  async updateContentUsingPOST_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<EmailTemplateNewResponse> {
    return makeEmailTemplateNewResponse()
  }

  async bulkGetUsingPOST_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<EmailTemplateNewResponse> {
    return makeEmailTemplateNewResponse()
  }

  async bulkUsedByUsingPOST_emailtemplate(
    ..._arguments: unknown[]
  ): Promise<BulkUsedByResponse> {
    return makeBulkUsedByResponse()
  }
}
