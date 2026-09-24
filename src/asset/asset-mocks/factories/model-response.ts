import type { ModelResponse } from '../../asset-definitions/responses/model-response'

export function makeModelResponse(
  overrides: Partial<ModelResponse> = {},
): ModelResponse {
  return {
    ...overrides,
  }
}
