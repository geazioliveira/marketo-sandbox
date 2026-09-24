import type { MultipartFile } from '../../asset-definitions/models/multipart-file'

export function makeMultipartFile(
  overrides: Partial<MultipartFile> = {},
): MultipartFile {
  return {
    ...overrides,
  }
}
