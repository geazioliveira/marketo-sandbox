import type { EditorContextDto } from '../../asset-definitions/models/editor-context-dto'

export function makeEditorContextDto(
  overrides: Partial<EditorContextDto> = {},
): EditorContextDto {
  return {
    dynamicContent: {},
    ...overrides,
  }
}
