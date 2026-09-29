#!/usr/bin/env python3
"""Generate TypeScript definition interfaces from the Marketo Swagger documents."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from marketo_codegen import (  # noqa: E402
    Target,
    add_target_arguments,
    check_output,
    definition_category as category,
    definition_file as file_name,
    document_path,
    generated_header,
    is_type_alias,
    pascal_case,
    property_key as property_name,
    quote,
    reference_name,
    resolve_targets,
    write_output,
)


CATEGORIES = ("models", "requests", "responses")


def description_comment(description: str, indent: str = "") -> list[str]:
    sanitized = description.replace("*/", "* /")
    return [f"{indent}/**", *[f"{indent} * {line}" for line in sanitized.splitlines()], f"{indent} */"]


def literal(value: Any) -> str:
    return json.dumps(value)


class TypeScriptGenerator:
    def __init__(self, definitions: dict[str, dict[str, Any]]) -> None:
        self.definitions = definitions

    def type_name(self, schema: dict[str, Any], imports: set[str]) -> str:
        if "$ref" in schema:
            name = reference_name(schema["$ref"])
            imports.add(name)
            return name

        if "enum" in schema:
            return " | ".join(literal(value) for value in schema["enum"])

        schema_type = schema.get("type")
        if schema_type == "array":
            item_type = self.type_name(schema.get("items", {}), imports)
            return f"Array<{item_type}>"
        if schema_type == "object" or "properties" in schema:
            additional = schema.get("additionalProperties")
            if additional is True:
                return "Record<string, unknown>"
            if isinstance(additional, dict):
                return f"Record<string, {self.type_name(additional, imports)}>"
            if "properties" not in schema:
                return "Record<string, unknown>"

            properties = schema["properties"]
            required = set(schema.get("required", []))
            members = [
                f"{property_name(name)}{' ' if name in required else '? '}: {self.type_name(value, imports)}"
                for name, value in properties.items()
            ]
            return "{ " + "; ".join(members) + " }"

        return {
            "string": "string",
            "integer": "number",
            "number": "number",
            "boolean": "boolean",
        }.get(schema_type, "unknown")

    def render(self, name: str, schema: dict[str, Any]) -> str:
        if is_type_alias(schema):
            return self.render_alias(name, schema)

        imports: set[str] = set()
        inline_types: list[str] = []
        bases: list[str] = []
        properties: dict[str, dict[str, Any]] = {}
        required: set[str] = set(schema.get("required", []))

        for item in schema.get("allOf", []):
            if "$ref" in item:
                base = reference_name(item["$ref"])
                imports.add(base)
                bases.append(base)
            else:
                properties.update(item.get("properties", {}))
                required.update(item.get("required", []))

        properties.update(schema.get("properties", {}))
        for property_schema in properties.values():
            self.type_name(property_schema, imports)

        imports.discard(name)
        import_lines = [
            f"import type {{ {import_name} }} from '{self.import_path(name, import_name)}';"
            for import_name in sorted(imports)
        ]

        member_lines: list[str] = []
        for property_name_value, property_schema in properties.items():
            type_name = self.type_name(property_schema, set())
            if "enum" in property_schema:
                enum_name = f"{name}{pascal_case(property_name_value)}"
                inline_types.append(
                    f"export type {enum_name} = {' | '.join(literal(value) for value in property_schema['enum'])};"
                )
                type_name = enum_name

            if description := property_schema.get("description"):
                member_lines.extend(description_comment(description, "  "))
            optional = "" if property_name_value in required else "?"
            member_lines.append(f"  {property_name(property_name_value)}{optional}: {type_name};")

        extends = f" extends {', '.join(bases)}" if bases else ""
        definition = [*import_lines]
        if import_lines:
            definition.append("")
        definition.extend(inline_types)
        if inline_types:
            definition.append("")
        definition.append(f"export interface {name}{extends} {{")
        definition.extend(member_lines)
        definition.append("}")
        return "\n".join(definition) + "\n"

    def render_alias(self, name: str, schema: dict[str, Any]) -> str:
        """A definition with no members, such as a top-level array, as a type alias (#24)."""
        imports: set[str] = set()
        alias = self.type_name(schema, imports)
        imports.discard(name)
        definition = [
            f"import type {{ {import_name} }} from '{self.import_path(name, import_name)}';"
            for import_name in sorted(imports)
        ]
        if definition:
            definition.append("")
        definition.append(f"export type {name} = {alias};")
        return "\n".join(definition) + "\n"

    def import_path(self, source: str, target: str) -> str:
        source_category = category(source)
        target_category = category(target)
        target_file = file_name(target)
        return f'./{target_file}' if source_category == target_category else f'../{target_category}/{target_file}'


def swagger_source(target: Target) -> str:
    """The document the area is generated from, written as the header writes it, and the sha256 of
    its bytes as committed (#19).

    The bytes are hashed as they are, never with their line endings normalised: .gitattributes keeps
    docs/marketo-swagger-*.json out of every conversion, so every checkout hashes the same bytes.
    """
    document = document_path(target.source) or target.source.name
    digest = hashlib.sha256(target.source.read_bytes()).hexdigest()
    return f"export const swaggerSource = {{ document: {quote(document)}, sha256: {quote(digest)} }} as const;\n"


def generated_files(target: Target, definitions: dict[str, dict[str, Any]]) -> dict[Path, str]:
    generator = TypeScriptGenerator(definitions)
    files = {
        target.definitions / category(name) / f"{file_name(name)}.ts": generator.render(name, schema)
        for name, schema in definitions.items()
    }
    files[target.definitions / "swagger-source.ts"] = swagger_source(target)
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if generated definitions are stale")
    add_target_arguments(parser)
    arguments = parser.parse_args()

    status = 0
    for target in resolve_targets(arguments):
        files = generated_files(target, target.schemas())
        label = f"{target.key} TypeScript definitions"
        header = generated_header(Path(__file__).name, target)
        status |= (
            check_output(target.definitions, files, label, header)
            if arguments.check
            else write_output(target.definitions, files, label, header)
        )
    return status


if __name__ == "__main__":
    raise SystemExit(main())
