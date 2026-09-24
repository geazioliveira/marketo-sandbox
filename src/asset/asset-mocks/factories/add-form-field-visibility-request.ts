import type { AddFormFieldVisibilityRequest } from '../../asset-definitions/requests/add-form-field-visibility-request'
import { makeFormFieldVisibilityRequest } from './form-field-visibility-request'

export function makeAddFormFieldVisibilityRequest(
  overrides: Partial<AddFormFieldVisibilityRequest> = {},
): AddFormFieldVisibilityRequest {
  return {
    visibilityRule: makeFormFieldVisibilityRequest(),
    ...overrides,
  }
}
