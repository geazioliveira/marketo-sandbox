import type { ObservableOfInputStreamContent } from '../../lead-database-definitions/models/observable-of-input-stream-content'

export function makeObservableOfInputStreamContent(
  overrides: Partial<ObservableOfInputStreamContent> = {},
): ObservableOfInputStreamContent {
  return {
    ...overrides,
  }
}
