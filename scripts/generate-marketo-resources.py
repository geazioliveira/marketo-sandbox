#!/usr/bin/env python3
"""Generate NestJS asset resource contracts from the Marketo Swagger paths."""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from marketo_codegen import (  # noqa: E402
    ROOT,
    camel_case,
    check_output,
    definition_category,
    definition_file,
    kebab_case,
    load_document,
    pascal_case,
    quote,
    reference_name,
    write_output,
)


OUTPUT = ROOT / "src" / "asset" / "resources"
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}

DECORATORS = {
    "body": "Body",
    "path": "Param",
    "query": "Query",
    "header": "Headers",
    "formData": "Body",
}


def schema_type(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        return reference_name(schema["$ref"])
    if enum := schema.get("enum"):
        return " | ".join(quote(value) for value in enum)
    if schema.get("type") == "array":
        return f"Array<{schema_type(schema.get('items', {}))}>"
    return {
        "string": "string",
        "integer": "number",
        "number": "number",
        "boolean": "boolean",
        "object": "Record<string, unknown>",
    }.get(schema.get("type"), "unknown")


def definition_import(name: str) -> str:
    return f"../../../asset-definitions/{definition_category(name)}/{definition_file(name)}"


def factory_import(name: str) -> str:
    return f"../../../asset-mocks/factories/{definition_file(name)}"


def factory_name(name: str) -> str:
    return f"make{name[:1].upper()}{name[1:]}"


def nest_route(path: str) -> str:
    return re.sub(r"\{([^}]+)}", r":\1", path.lstrip("/"))


def parameter_identifier(name: str, index: int) -> str:
    identifier = camel_case(name)
    if not identifier or not re.match(r"^[A-Za-z_$]", identifier):
        identifier = f"parameter{index}"
    return identifier if identifier not in {"default", "new", "delete"} else f"{identifier}Value"


def decorator_for(parameter: dict[str, Any]) -> str:
    location = parameter["in"]
    if location == "body":
        return "@Body()"
    return f"@{DECORATORS[location]}('{parameter['name']}')"


def operation_response(operation: dict[str, Any]) -> tuple[str, str | None]:
    """Return the success type plus the definition that backs it, when there is one."""
    types: list[str] = []
    backing: str | None = None
    for status, response in operation.get("responses", {}).items():
        if not status.startswith("2"):
            continue
        schema = response.get("schema")
        if schema is None:
            continue
        types.append(schema_type(schema))
        if backing is None and "$ref" in schema:
            backing = reference_name(schema["$ref"])
    return (" | ".join(dict.fromkeys(types)) or "void", backing)


def render_controller(tag: str, operations: list[tuple[str, str, dict[str, Any]]]) -> str:
    resource_name = pascal_case(tag)
    service_name = f"{resource_name}Service"
    service_property = f"{camel_case(resource_name)}Service"
    imports = {"Controller"}
    definition_imports: set[str] = set()
    methods: list[str] = []

    for method, path, operation in operations:
        imports.add(method.capitalize())
        operation_id = operation["operationId"]
        response_type, backing = operation_response(operation)
        if backing:
            definition_imports.add(backing)

        arguments: list[str] = []
        argument_names: list[str] = []
        used_names: set[str] = set()
        # Swagger can list optional parameters before required ones, which is illegal in
        # TypeScript. Decorators bind by name, so ordering required-first is safe.
        ordered = sorted(
            operation.get("parameters", []),
            key=lambda parameter: not parameter.get("required", False),
        )
        for index, parameter in enumerate(ordered):
            imports.add(DECORATORS[parameter["in"]])
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

        methods.extend(
            [
                f"  @{method.capitalize()}('{nest_route(path)}')",
                f"  async {operation_id}({', '.join(arguments)}): Promise<{response_type}> {{",
                f"    return this.{service_property}.{operation_id}({', '.join(argument_names)})",
                "  }",
                "",
            ],
        )

    lines = [
        f"import {{ {', '.join(sorted(imports))} }} from '@nestjs/common'",
        f"import {{ {service_name} }} from './{kebab_case(tag)}.service'",
    ]
    if definition_imports:
        lines.append("")
        lines.extend(
            f"import type {{ {name} }} from '{definition_import(name)}'"
            for name in sorted(definition_imports)
        )
    lines.extend(
        [
            "",
            "@Controller()",
            f"export class {resource_name}Controller {{",
            f"  constructor(private readonly {service_property}: {service_name}) {{}}",
            "",
            *methods[:-1],
            "}",
        ],
    )
    return "\n".join(lines) + "\n"


def render_service(tag: str, operations: list[tuple[str, str, dict[str, Any]]]) -> str:
    """Services return faker-backed payloads so the API is usable without a live Marketo tenant."""
    resource_name = pascal_case(tag)
    definition_imports: set[str] = set()
    factory_imports: set[str] = set()
    methods: list[str] = []

    for _, _, operation in operations:
        operation_id = operation["operationId"]
        response_type, backing = operation_response(operation)
        if backing:
            definition_imports.add(backing)
            factory_imports.add(backing)
            body = f"return {factory_name(backing)}()"
        else:
            body = "return undefined as never"
        methods.extend(
            [
                f"  async {operation_id}(..._arguments: unknown[]): Promise<{response_type}> {{",
                f"    {body}",
                "  }",
                "",
            ],
        )

    lines = ["import { Injectable } from '@nestjs/common'"]
    lines.extend(
        f"import {{ {factory_name(name)} }} from '{factory_import(name)}'"
        for name in sorted(factory_imports)
    )
    if definition_imports:
        lines.append("")
        lines.extend(
            f"import type {{ {name} }} from '{definition_import(name)}'"
            for name in sorted(definition_imports)
        )
    lines.extend(
        [
            "",
            "@Injectable()",
            f"export class {resource_name}Service {{",
            *methods[:-1],
            "}",
        ],
    )
    return "\n".join(lines) + "\n"


def render_module(tag: str) -> str:
    resource_name = pascal_case(tag)
    slug = kebab_case(tag)
    return "\n".join(
        [
            "import { Module } from '@nestjs/common'",
            f"import {{ {resource_name}Controller }} from './{slug}.controller'",
            f"import {{ {resource_name}Service }} from './{slug}.service'",
            "",
            "@Module({",
            f"  controllers: [{resource_name}Controller],",
            f"  providers: [{resource_name}Service],",
            f"  exports: [{resource_name}Service],",
            "})",
            f"export class {resource_name}Module {{}}",
            "",
        ],
    )


def render_resources_module(slugs: list[str]) -> str:
    imports = [
        f"import {{ {pascal_case(slug)}Module }} from './{slug}/{slug}.module'" for slug in slugs
    ]
    modules = ",\n    ".join(f"{pascal_case(slug)}Module" for slug in slugs)
    return "\n".join(
        [
            "import { Module } from '@nestjs/common'",
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


def generated_files(document: dict[str, Any]) -> dict[Path, str]:
    grouped: dict[str, list[tuple[str, str, dict[str, Any]]]] = defaultdict(list)
    for path, path_item in document["paths"].items():
        for method, operation in path_item.items():
            if method in HTTP_METHODS:
                grouped[operation["tags"][0]].append((method, path, operation))

    files: dict[Path, str] = {}
    for tag, operations in grouped.items():
        slug = kebab_case(tag)
        directory = OUTPUT / slug
        files[directory / f"{slug}.controller.ts"] = render_controller(tag, operations)
        files[directory / f"{slug}.service.ts"] = render_service(tag, operations)
        files[directory / f"{slug}.module.ts"] = render_module(tag)
    files[OUTPUT / "asset-resources.module.ts"] = render_resources_module(
        sorted(kebab_case(tag) for tag in grouped),
    )
    return files


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated resources are stale")
    arguments = parser.parse_args()

    files = generated_files(load_document())
    label = "resource files"
    return check_output(OUTPUT, files, label) if arguments.check else write_output(OUTPUT, files, label)


if __name__ == "__main__":
    raise SystemExit(main())
