import type { ObservableOfInputStreamRangeContent } from '../../lead-database-definitions/models/observable-of-input-stream-range-content'

export function makeObservableOfInputStreamRangeContent(
  overrides: Partial<ObservableOfInputStreamRangeContent> = {},
): ObservableOfInputStreamRangeContent {
  return {
    ...overrides,
  }
}
