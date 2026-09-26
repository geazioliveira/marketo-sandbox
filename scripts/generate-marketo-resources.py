#!/usr/bin/env python3
"""Generate NestJS resource contracts from the Marketo Swagger paths."""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from marketo_codegen import (  # noqa: E402
    Target,
    add_target_arguments,
    camel_case,
    check_output,
    definition_category,
    definition_file,
    generated_header,
    kebab_case,
    operation_parameters,
    operations,
    pascal_case,
    quote,
    reference_name,
    relative_import,
    resolve_targets,
    success_schemas,
    write_output,
)


DECORATORS = {
    "body": "Body",
    "path": "Param",
    "query": "Query",
    "header": "Headers",
    "formData": "Body",
}

RESERVED_IDENTIFIERS = {"default", "new", "delete", "function", "class", "return"}


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


def factory_name(name: str) -> str:
    return f"make{name[:1].upper()}{name[1:]}"


def nest_route(path: str) -> str:
    return re.sub(r"\{([^}]+)}", r":\1", path.lstrip("/"))


def parameter_identifier(name: str, index: int) -> str:
    identifier = camel_case(name)
    if not identifier or not re.match(r"^[A-Za-z_$]", identifier):
        identifier = f"parameter{index}"
    return identifier if identifier not in RESERVED_IDENTIFIERS else f"{identifier}Value"


def decorator_for(parameter: dict[str, Any]) -> str:
    location = parameter["in"]
    if location == "body":
        return "@Body()"
    return f"@{DECORATORS[location]}('{parameter['name']}')"


def success_status(operation: dict[str, Any], method: str) -> int | None:
    """The declared 2xx status, when it differs from the one Nest would send by default."""
    codes = sorted(
        int(status) for status in operation.get("responses", {}) if status.isdigit() and status.startswith("2")
    )
    if not codes:
        return None
    default = 201 if method == "post" else 200
    return codes[0] if codes[0] != default else None


def schema_references(schema: Any, acc: set[str] | None = None) -> set[str]:
    """Every definition name referenced anywhere inside a schema."""
    acc = acc if acc is not None else set()
    if not isinstance(schema, dict):
        return acc
    if "$ref" in schema:
        acc.add(reference_name(schema["$ref"]))
    for key in ("items", "additionalProperties"):
        if key in schema:
            schema_references(schema[key], acc)
    for sub_schema in schema.get("allOf", []):
        schema_references(sub_schema, acc)
    for property_schema in (schema.get("properties") or {}).values():
        schema_references(property_schema, acc)
    return acc


@dataclass(frozen=True)
class ResponseContract:
    """The success type of an operation plus how to mock it."""

    type_name: str
    references: frozenset[str]
    factory: str | None
    expression: str | None
    needs_faker: bool


def operation_response(operation: dict[str, Any]) -> ResponseContract:
    schemas = success_schemas(operation)
    types = list(dict.fromkeys(schema_type(schema) for schema in schemas))
    references = set().union(*(schema_references(schema) for schema in schemas)) if schemas else set()

    factory: str | None = None
    expression: str | None = None
    needs_faker = False
    # Only the first 2xx schema is mocked; a union of shapes has no single obvious payload.
    if schemas:
        primary = schemas[0]
        if "$ref" in primary:
            factory = reference_name(primary["$ref"])
            expression = f"{factory_name(factory)}()"
        elif primary.get("type") == "array" and "$ref" in (primary.get("items") or {}):
            factory = reference_name(primary["items"]["$ref"])
            expression = (
                f"faker.helpers.multiple(() => {factory_name(factory)}(), "
                "{ count: { min: 1, max: 3 } })"
            )
            needs_faker = True

    return ResponseContract(
        type_name=" | ".join(types) or "void",
        references=frozenset(references),
        factory=factory,
        expression=expression,
        needs_faker=needs_faker,
    )


class ResourceGenerator:
    """Renders one Nest resource per Swagger tag for a single target."""

    def __init__(self, target: Target) -> None:
        self.target = target
        # Every resource file sits one level below `resources/`, so imports resolve from there.
        self.resource_dir = target.resources / "resource"

    def definition_import(self, name: str) -> str:
        return relative_import(
            self.resource_dir,
            self.target.definitions / definition_category(name) / f"{definition_file(name)}.ts",
        )

    def factory_import(self, name: str) -> str:
        return relative_import(
            self.resource_dir,
            self.target.factories / f"{definition_file(name)}.ts",
        )

    def render_controller(self, tag: str, tagged: list[tuple[str, str, dict[str, Any]]]) -> str:
        resource_name = pascal_case(tag)
        service_name = f"{resource_name}Service"
        service_property = f"{camel_case(resource_name)}Service"
        imports = {"Controller"}
        definition_imports: set[str] = set()
        methods: list[str] = []

        for method, path, operation in tagged:
            imports.add(method.capitalize())
            if success_status(operation, method) is not None:
                imports.add("HttpCode")
            response = operation_response(operation)
            definition_imports.update(response.references)

            arguments: list[str] = []
            argument_names: list[str] = []
            used_names: set[str] = set()
            # Swagger can list optional parameters before required ones, which is illegal in
            # TypeScript. Decorators bind by name, so ordering required-first is safe.
            ordered = sorted(
                operation_parameters(operation),
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
                definition_imports.update(schema_references(schema))
                optional = "" if parameter.get("required", False) else "?"
                arguments.append(f"{decorator_for(parameter)} {identifier}{optional}: {type_name}")
                argument_names.append(identifier)

            methods.extend(
                [
                    f"  @{method.capitalize()}('{nest_route(path)}')",
                    *(
                        [f"  @HttpCode({status})"]
                        if (status := success_status(operation, method)) is not None
                        else []
                    ),
                    f"  async {operation['operationId']}({', '.join(arguments)}): "
                    f"Promise<{response.type_name}> {{",
                    f"    return this.{service_property}.{operation['operationId']}"
                    f"({', '.join(argument_names)})",
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
                f"import type {{ {name} }} from '{self.definition_import(name)}'"
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

    def render_service(self, tag: str, tagged: list[tuple[str, str, dict[str, Any]]]) -> str:
        """Services return faker payloads so the API is usable without a live Marketo tenant."""
        resource_name = pascal_case(tag)
        definition_imports: set[str] = set()
        factory_imports: set[str] = set()
        needs_faker = False
        methods: list[str] = []

        for _, _, operation in tagged:
            response = operation_response(operation)
            definition_imports.update(response.references)
            signature = (
                f"  async {operation['operationId']}(..._arguments: unknown[]): "
                f"Promise<{response.type_name}> {{"
            )
            if response.expression:
                factory_imports.add(response.factory)
                needs_faker = needs_faker or response.needs_faker
                methods.extend([signature, f"    return {response.expression}", "  }", ""])
            elif response.type_name == "void":
                # Responses such as `202 Accepted` carry no body at all.
                methods.extend([signature, "  }", ""])
            else:
                methods.extend([signature, "    return undefined as never", "  }", ""])

        lines = ["import { Injectable } from '@nestjs/common'"]
        if needs_faker:
            lines.append("import { faker } from '@faker-js/faker'")
        lines.extend(
            f"import {{ {factory_name(name)} }} from '{self.factory_import(name)}'"
            for name in sorted(factory_imports)
        )
        if definition_imports:
            lines.append("")
            lines.extend(
                f"import type {{ {name} }} from '{self.definition_import(name)}'"
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

    def render_module(self, tag: str) -> str:
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

    def render_resources_module(self, slugs: list[str]) -> str:
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
                f"export class {pascal_case(self.target.area)}ResourcesModule {{}}",
                "",
            ],
        )

    def files(self) -> dict[Path, str]:
        grouped: dict[str, list[tuple[str, str, dict[str, Any]]]] = defaultdict(list)
        for method, path, operation in operations(self.target.document()):
            grouped[operation["tags"][0]].append((method, path, operation))

        output = self.target.resources
        files: dict[Path, str] = {}
        for tag, tagged in grouped.items():
            slug = kebab_case(tag)
            directory = output / slug
            files[directory / f"{slug}.controller.ts"] = self.render_controller(tag, tagged)
            files[directory / f"{slug}.service.ts"] = self.render_service(tag, tagged)
            files[directory / f"{slug}.module.ts"] = self.render_module(tag)
        files[output / f"{self.target.area}-resources.module.ts"] = self.render_resources_module(
            sorted(kebab_case(tag) for tag in grouped),
        )
        return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if generated resources are stale")
    add_target_arguments(parser)
    arguments = parser.parse_args()

    status = 0
    for target in resolve_targets(arguments):
        files = ResourceGenerator(target).files()
        label = f"{target.key} resource files"
        header = generated_header(Path(__file__).name, target.source)
        status |= (
            check_output(target.resources, files, label, header)
            if arguments.check
            else write_output(target.resources, files, label, header)
        )
    return status


if __name__ == "__main__":
    raise SystemExit(main())
