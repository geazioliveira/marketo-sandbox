#!/usr/bin/env python3
"""Generate NestJS asset resource contracts from the Marketo Swagger paths."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "marketo-swagger-asset.json"
OUTPUT = ROOT / "src" / "asset" / "resources"
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def kebab_case(value: str) -> str:
    normalized = value.replace("(", "").replace(")", "")
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", normalized)
    return re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()


def pascal_case(value: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in re.findall(r"[A-Za-z0-9]+", value))


def camel_case(value: str) -> str:
    parts = re.findall(r"[A-Za-z0-9]+", value)
    return parts[0][:1].lower() + parts[0][1:] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def definition_category(name: str) -> str:
    if name.endswith("Request"):
        return "requests"
    if name.endswith("Response"):
        return "responses"
    return "models"


def definition_file(name: str) -> str:
    return re.sub(
        r"([a-z0-9])([A-Z])",
        r"\1-\2",
        re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1-\2", name),
    ).lower()


def definition_name(reference: str) -> str:
    return reference.rsplit("/", maxsplit=1)[-1]


def schema_type(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        return definition_name(schema["$ref"])
    if "enum" in schema:
        return " | ".join(json.dumps(value) for value in schema["enum"])
    if schema.get("type") == "array":
        return f"Array<{schema_type(schema.get('items', {}))}>"
    return {
        "string": "string",
        "integer": "number",
        "number": "number",
        "boolean": "boolean",
        "object": "Record<string, unknown>",
    }.get(schema.get("type"), "unknown")


def import_definition(name: str) -> str:
    return f"../../../asset-definitions/{definition_category(name)}/{definition_file(name)}.js"


def parameter_identifier(name: str, index: int) -> str:
    identifier = camel_case(name)
    if not identifier or not re.match(r"^[A-Za-z_$]", identifier):
        identifier = f"parameter{index}"
    return identifier if identifier not in {"default", "new", "delete"} else f"{identifier}Value"


def decorator_for(parameter: dict[str, Any]) -> str:
    location = parameter["in"]
    name = parameter["name"]
    if location == "body":
        return "@Body()"
    if location == "path":
        return f"@Param('{name}')"
    if location == "query":
        return f"@Query('{name}')"
    if location == "header":
        return f"@Headers('{name}')"
    if location == "formData":
        return f"@Body('{name}')"
    raise ValueError(f"Unsupported parameter location: {location}")


def operation_response(operation: dict[str, Any]) -> tuple[str, set[str]]:
    references: set[str] = set()
    types: list[str] = []
    for status, response in operation.get("responses", {}).items():
        if not status.startswith("2"):
            continue
        schema = response.get("schema")
        if schema is None:
            continue
        type_name = schema_type(schema)
        types.append(type_name)
        if "$ref" in schema:
            references.add(type_name)
    return (" | ".join(dict.fromkeys(types)) or "void", references)


def render_controller(tag: str, operations: list[tuple[str, str, dict[str, Any]]]) -> str:
    resource_name = pascal_case(tag)
    service_name = f"{resource_name}Service"
    imports = {"Controller"}
    definition_imports: set[str] = set()
    methods: list[str] = []

    for method, path, operation in operations:
        imports.add(method.capitalize())
        operation_id = operation["operationId"]
        parameters = operation.get("parameters", [])
        response_type, response_references = operation_response(operation)
        definition_imports.update(response_references)
        arguments: list[str] = []
        argument_names: list[str] = []
        used_names: set[str] = set()
        for index, parameter in enumerate(parameters):
            imports.add(
                {
                    "body": "Body",
                    "path": "Param",
                    "query": "Query",
                    "header": "Headers",
                    "formData": "Body",
                }[parameter["in"]],
            )
            identifier = parameter_identifier(parameter.get("name", "body"), index)
            while identifier in used_names:
                identifier = f"{identifier}{index}"
            used_names.add(identifier)
            schema = parameter.get("schema", parameter)
            type_name = schema_type(schema)
            if "$ref" in schema:
                definition_imports.add(type_name)
            optional = "" if parameter.get("required", False) else "?"
            arguments.append(f"{decorator_for(parameter)} {identifier}{optional}: {type_name}")
            argument_names.append(identifier)

        decorator = method.capitalize()
        route = re.sub(r"\{([^}]+)}", r":\1", path.lstrip("/"))
        methods.extend(
            [
                f"  @{decorator}('{route}')",
                f"  async {operation_id}({', '.join(arguments)}): Promise<{response_type}> {{",
                f"    return this.{camel_case(resource_name)}Service.{operation_id}({', '.join(argument_names)});",
                "  }",
                "",
            ],
        )

    imports_list = ", ".join(sorted(imports))
    type_imports = "\n".join(
        f"import type {{ {name} }} from '{import_definition(name)}';"
        for name in sorted(definition_imports)
    )
    return "\n".join(
        [
            f"import {{ {imports_list} }} from '@nestjs/common';",
            f"import {{ {service_name} }} from './{kebab_case(tag)}.service.js';",
            *(["", type_imports] if type_imports else []),
            "",
            "@Controller()",
            f"export class {resource_name}Controller {{",
            f"  constructor(private readonly {camel_case(resource_name)}Service: {service_name}) {{}}",
            "",
            *methods[:-1],
            "}",
            "",
        ],
    )


def render_service(tag: str, operations: list[tuple[str, str, dict[str, Any]]]) -> str:
    resource_name = pascal_case(tag)
    methods = []
    for _, _, operation in operations:
        operation_id = operation["operationId"]
        methods.extend(
            [
                f"  async {operation_id}(..._arguments: unknown[]): Promise<never> {{",
                f"    throw new NotImplementedException('{operation_id} is not implemented.');",
                "  }",
                "",
            ],
        )
    return "\n".join(
        [
            "import { Injectable, NotImplementedException } from '@nestjs/common';",
            "",
            "@Injectable()",
            f"export class {resource_name}Service {{",
            *methods[:-1],
            "}",
            "",
        ],
    )


def render_module(tag: str) -> str:
    resource_name = pascal_case(tag)
    slug = kebab_case(tag)
    return "\n".join(
        [
            "import { Module } from '@nestjs/common';",
            f"import {{ {resource_name}Controller }} from './{slug}.controller.js';",
            f"import {{ {resource_name}Service }} from './{slug}.service.js';",
            "",
            "@Module({",
            f"  controllers: [{resource_name}Controller],",
            f"  providers: [{resource_name}Service],",
            "})",
            f"export class {resource_name}Module {{}}",
            "",
        ],
    )


def generated_files(document: dict[str, Any]) -> dict[Path, str]:
    grouped: dict[str, list[tuple[str, str, dict[str, Any]]]] = defaultdict(list)
    for path, path_item in document["paths"].items():
        for method, operation in path_item.items():
            if method not in HTTP_METHODS:
                continue
            grouped[operation["tags"][0]].append((method, path, operation))

    files: dict[Path, str] = {}
    for tag, operations in grouped.items():
        slug = kebab_case(tag)
        directory = OUTPUT / slug
        files[directory / f"{slug}.controller.ts"] = render_controller(tag, operations)
        files[directory / f"{slug}.service.ts"] = render_service(tag, operations)
        files[directory / f"{slug}.module.ts"] = render_module(tag)
    return files


def render_resources_module(files: dict[Path, str]) -> str:
    tags = sorted({path.parent.name for path in files})
    imports = [
        f"import {{ {pascal_case(tag)}Module }} from './{tag}/{tag}.module.js';"
        for tag in tags
    ]
    modules = ",\n    ".join(f"{pascal_case(tag)}Module" for tag in tags)
    return "\n".join(
        [
            "import { Module } from '@nestjs/common';",
            *imports,
            "",
            "@Module({",
            "  imports: [",
            f"    {modules},",
            "  ],",
            "})",
            "export class AssetResourcesModule {}",
            "",
        ],
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated resources are stale")
    args = parser.parse_args()

    document = json.loads(SOURCE.read_text())
    files = generated_files(document)
    files[OUTPUT / "asset-resources.module.ts"] = render_resources_module(files)

    if args.check:
        stale = [path for path, content in files.items() if not path.is_file() or path.read_text() != content]
        unexpected = [path for path in OUTPUT.rglob("*.ts") if path not in files] if OUTPUT.exists() else []
        if stale or unexpected:
            print(f"Generated resources are stale: {len(stale)} missing or changed, {len(unexpected)} unexpected.")
            return 1
        print(f"All {len(files)} generated resource files are current.")
        return 0

    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    print(f"Generated {len(files)} resource files for {len(document['paths'])} Swagger paths.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
