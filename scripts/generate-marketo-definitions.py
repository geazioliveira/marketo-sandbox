#!/usr/bin/env python3
"""Generate TypeScript definition interfaces from the Marketo Swagger document."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "marketo-swagger-asset.json"
OUTPUT = ROOT / "src" / "asset-definitions"
CATEGORIES = ("models", "requests", "responses")


def category(name: str) -> str:
    if name.endswith("Request"):
        return "requests"
    if name.endswith("Response"):
        return "responses"
    return "models"


def file_name(name: str) -> str:
    return re.sub(
        r"([a-z0-9])([A-Z])",
        r"\1-\2",
        re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1-\2", name),
    ).lower()


def reference_name(reference: str) -> str:
    return reference.rsplit("/", maxsplit=1)[-1]


def property_name(name: str) -> str:
    return name if re.match(r"^[A-Za-z_$][A-Za-z0-9_$]*$", name) and name != "default" else json.dumps(name)


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
                enum_name = f"{name}{property_name_value[:1].upper()}{property_name_value[1:]}"
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

    def import_path(self, source: str, target: str) -> str:
        source_category = category(source)
        target_category = category(target)
        target_file = file_name(target)
        return f'./{target_file}.js' if source_category == target_category else f'../{target_category}/{target_file}.js'


def generated_files(definitions: dict[str, dict[str, Any]]) -> dict[Path, str]:
    generator = TypeScriptGenerator(definitions)
    return {
        OUTPUT / category(name) / f"{file_name(name)}.ts": generator.render(name, schema)
        for name, schema in definitions.items()
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated files are stale")
    args = parser.parse_args()

    with SOURCE.open() as source_file:
        definitions = json.load(source_file)["definitions"]
    files = generated_files(definitions)

    if args.check:
        stale = [path for path, content in files.items() if not path.is_file() or path.read_text() != content]
        unexpected = [
            path
            for category_name in CATEGORIES
            for path in (OUTPUT / category_name).glob("*.ts")
            if path not in files
        ]
        if stale or unexpected:
            print(f"Generated definitions are stale: {len(stale)} missing or changed, {len(unexpected)} unexpected.")
            return 1
        print(f"All {len(files)} TypeScript definitions are current.")
        return 0

    for category_name in CATEGORIES:
        directory = OUTPUT / category_name
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir(parents=True)
    for path, content in files.items():
        path.write_text(content)
    print(f"Generated {len(files)} TypeScript definitions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
