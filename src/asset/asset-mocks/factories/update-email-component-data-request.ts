import type { UpdateEmailComponentDataRequest } from '../../asset-definitions/requests/update-email-component-data-request'
import { makeEmailHeaderField } from './email-header-field'

export function makeUpdateEmailComponentDataRequest(
  overrides: Partial<UpdateEmailComponentDataRequest> = {},
): UpdateEmailComponentDataRequest {
  return {
    fromEmail: makeEmailHeaderField(),
    fromName: makeEmailHeaderField(),
    replyTO: makeEmailHeaderField(),
    subject: makeEmailHeaderField(),
    ...overrides,
  }
}
