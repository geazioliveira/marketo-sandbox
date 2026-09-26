import type { InputStream } from '../../lead-database-definitions/models/input-stream'

export function makeInputStream(
  overrides: Partial<InputStream> = {},
): InputStream {
  return {
    ...overrides,
  }
}
