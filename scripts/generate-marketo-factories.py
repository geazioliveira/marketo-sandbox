#!/usr/bin/env python3
"""Generate faker-based mock factories for every Marketo Swagger definition."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from marketo_codegen import (  # noqa: E402
    Output,
    SHARED_MOCKS,
    Target,
    add_target_arguments,
    camel_case,
    check_outputs,
    definition_category,
    definition_file,
    generated_header,
    property_key,
    quote,
    reference_name,
    relative_import,
    resolve_targets,
    write_outputs,
)


#: Marketo response envelopes must look like a successful call, not random noise.
ENVELOPE_VALUES = {
    "success": "true",
    "requestId": "mockRequestId()",
    "errors": "[]",
    "warnings": "[]",
}

#: Property-name heuristics, matched in order, so mock data stays contextually believable.
STRING_HEURISTICS: list[tuple[str, str]] = [
    (r"^requestid$", "mockRequestId()"),
    (r"email$|^email|emailaddress", "faker.internet.email()"),
    (r"^hostname$|domain", "faker.internet.domainName()"),
    (r"url$|^url|link", "faker.internet.url()"),
    (r"mimetype", "faker.system.mimeType()"),
    (r"^workspace$", "'Default'"),
    (r"^code$", "faker.string.numeric(4)"),
    (r"message$|^message", "faker.lorem.sentence()"),
    (r"description$", "faker.lorem.sentence()"),
    (r"subject|preheader|label|title", "faker.lorem.words({ min: 2, max: 5 })"),
    (r"html|content|text|body", "faker.lorem.paragraph()"),
    (r"createdat|updatedat|date|^startat$|^endat$", "faker.date.recent().toISOString()"),
    (r"name$|^name", "faker.lorem.words({ min: 2, max: 3 })"),
]

#: Some Marketo fields are effectively enums but are typed as free-form strings in the
#: spec. Recover the real domain from the documented description so mocks stay valid.
DESCRIPTION_HEURISTICS: list[tuple[str, str]] = [
    (r"draft or approved", "faker.helpers.arrayElement(['approved', 'draft'] as const)"),
    (r"info, warning, or error", "faker.helpers.arrayElement(['info', 'warning', 'error'] as const)"),
]


def factory_name(name: str) -> str:
    return f"make{name[:1].upper()}{name[1:]}"


class FactoryGenerator:
    def __init__(self, target: Target, definitions: dict[str, dict[str, Any]]) -> None:
        self.target = target
        self.definitions = definitions
        self.dependencies = {name: self._dependencies(schema) for name, schema in definitions.items()}

    def definition_import(self, name: str) -> str:
        return relative_import(
            self.target.factories,
            self.target.definitions / definition_category(name) / f"{definition_file(name)}.ts",
        )

    def shared_import(self, module: str) -> str:
        return relative_import(self.target.factories, SHARED_MOCKS / f"{module}.ts")

    def _dependencies(self, schema: Any, acc: set[str] | None = None) -> set[str]:
        acc = acc if acc is not None else set()
        if not isinstance(schema, dict):
            return acc
        if "$ref" in schema:
            acc.add(reference_name(schema["$ref"]))
        for key in ("items", "additionalProperties"):
            if key in schema:
                self._dependencies(schema[key], acc)
        for sub_schema in schema.get("allOf", []):
            self._dependencies(sub_schema, acc)
        for property_schema in (schema.get("properties") or {}).values():
            self._dependencies(property_schema, acc)
        return acc

    def reaches(self, start: str, target: str) -> bool:
        """True when `start` can transitively reach `target`, i.e. recursing would not terminate."""
        seen: set[str] = set()
        queue = [start]
        while queue:
            current = queue.pop()
            if current == target:
                return True
            if current in seen:
                continue
            seen.add(current)
            queue.extend(self.dependencies.get(current, ()))
        return False

    def value(self, owner: str, property_name: str, schema: dict[str, Any], imports: set[str]) -> str | None:
        """Render the faker expression for one property, or None when it must be skipped."""
        if "$ref" in schema:
            target = reference_name(schema["$ref"])
            if self.reaches(target, owner):
                return None
            imports.add(target)
            return f"{factory_name(target)}()"

        if enum := schema.get("enum"):
            values = ", ".join(quote(value) for value in enum)
            return f"faker.helpers.arrayElement([{values}] as const)"

        schema_type = schema.get("type")

        if schema_type == "array":
            items = schema.get("items", {})
            if "$ref" in items:
                target = reference_name(items["$ref"])
                if self.reaches(target, owner):
                    return "[]"
                imports.add(target)
                return (
                    f"faker.helpers.multiple(() => {factory_name(target)}(), "
                    "{ count: { min: 1, max: 3 } })"
                )
            item_value = self.value(owner, property_name, items, imports)
            if item_value is None:
                return "[]"
            if item_value.startswith("{"):
                item_value = f"({item_value})"
            return f"faker.helpers.multiple(() => {item_value}, {{ count: {{ min: 1, max: 3 }} }})"

        if schema_type == "object" or "properties" in schema:
            properties = schema.get("properties")
            if not properties:
                return "{}"
            members = []
            for nested_name, nested_schema in properties.items():
                nested_value = self.value(owner, nested_name, nested_schema, imports)
                if nested_value is not None:
                    members.append(f"{property_key(nested_name)}: {nested_value}")
            return "{ " + ", ".join(members) + " }"

        if schema_type == "boolean":
            return "faker.datatype.boolean()"

        if schema_type in {"integer", "number"}:
            lowered = property_name.lower()
            if schema.get("format") == "float" or schema_type == "number":
                return "faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })"
            if lowered == "id" or lowered.endswith("id"):
                return "faker.number.int({ min: 1, max: 99999 })"
            return "faker.number.int({ min: 1, max: 1000 })"

        if schema_type == "string":
            if schema.get("format") == "date-time":
                return "faker.date.recent().toISOString()"
            description = (schema.get("description") or "").lower()
            for pattern, expression in DESCRIPTION_HEURISTICS:
                if re.search(pattern, description):
                    return expression
            lowered = property_name.lower()
            for pattern, expression in STRING_HEURISTICS:
                if re.search(pattern, lowered):
                    return expression
            return "faker.lorem.word()"

        return "faker.lorem.word()"

    def render(self, name: str, schema: dict[str, Any]) -> str:
        imports: set[str] = set()
        bases: list[str] = []
        properties: dict[str, dict[str, Any]] = {}

        for sub_schema in schema.get("allOf", []):
            if "$ref" in sub_schema:
                base = reference_name(sub_schema["$ref"])
                bases.append(base)
                imports.add(base)
            else:
                properties.update(sub_schema.get("properties") or {})
        properties.update(schema.get("properties") or {})

        members: list[str] = [f"...{factory_name(base)}()" for base in bases]
        uses_envelope = False
        for property_name, property_schema in properties.items():
            if property_name in ENVELOPE_VALUES and "$ref" not in property_schema:
                expression = ENVELOPE_VALUES[property_name]
                uses_envelope = uses_envelope or expression == "mockRequestId()"
                members.append(f"{property_key(property_name)}: {expression}")
                continue
            expression = self.value(name, property_name, property_schema, imports)
            if expression is not None:
                members.append(f"{property_key(property_name)}: {expression}")

        imports.discard(name)
        uses_faker = any("faker." in member for member in members)

        lines: list[str] = []
        if uses_faker:
            lines.append("import { faker } from '@faker-js/faker'")
        if uses_envelope:
            lines.append(f"import {{ mockRequestId }} from '{self.shared_import('request-id')}'")
        lines.append(f"import type {{ {name} }} from '{self.definition_import(name)}'")
        for dependency in sorted(imports):
            lines.append(
                f"import {{ {factory_name(dependency)} }} from './{definition_file(dependency)}'",
            )
        lines.append("")
        lines.append(f"export function {factory_name(name)}(")
        lines.append(f"  overrides: Partial<{name}> = {{}},")
        lines.append(f"): {name} {{")
        lines.append("  return {")
        for member in members:
            lines.append(f"    {member},")
        lines.append("    ...overrides,")
        lines.append("  }")
        lines.append("}")
        return "\n".join(lines) + "\n"


def render_request_id() -> str:
    return "\n".join(
        [
            "import { faker } from '@faker-js/faker'",
            "",
            "/**",
            " * Marketo request ids look like `e42b#14272d07d78`.",
            " */",
            "export function mockRequestId(): string {",
            "  return `${faker.string.alphanumeric(4)}#${faker.string.alphanumeric(11)}`",
            "}",
            "",
        ],
    )


def render_seed() -> str:
    return "\n".join(
        [
            "import { faker } from '@faker-js/faker'",
            "",
            "/** Reference date used so generated timestamps are stable when seeded. */",
            "const DEFAULT_REF_DATE = '2024-01-01T00:00:00.000Z'",
            "",
            "/**",
            " * Seed faker so mock responses are reproducible across restarts.",
            " * Set MARKETO_MOCK_SEED to any integer to pin the generated data, and",
            " * MARKETO_MOCK_REF_DATE to control the date the mock timestamps hang off.",
            " */",
            "export function seedMockData(",
            "  seed: number | undefined = Number(process.env.MARKETO_MOCK_SEED) || undefined,",
            "  refDate: string = process.env.MARKETO_MOCK_REF_DATE ?? DEFAULT_REF_DATE,",
            "): void {",
            "  if (seed === undefined) {",
            "    return",
            "  }",
            "",
            "  faker.seed(seed)",
            "  // Without a fixed reference date, relative helpers such as `faker.date.recent()`",
            "  // stay anchored to the current clock and drift between runs.",
            "  faker.setDefaultRefDate(refDate)",
            "}",
            "",
        ],
    )


def render_index(definitions: dict[str, dict[str, Any]]) -> str:
    lines = [f"export * from './{definition_file(name)}'" for name in sorted(definitions)]
    return "\n".join(lines) + "\n"


def shared_files() -> dict[Path, str]:
    """Seeding and request ids are area-agnostic, so they live in one shared module."""
    return {
        SHARED_MOCKS / "request-id.ts": render_request_id(),
        SHARED_MOCKS / "seed.ts": render_seed(),
        SHARED_MOCKS / "index.ts": "export * from './request-id'\nexport * from './seed'\n",
    }


def generated_files(target: Target) -> dict[Path, str]:
    definitions = target.schemas()
    generator = FactoryGenerator(target, definitions)
    files: dict[Path, str] = {
        target.factories / f"{definition_file(name)}.ts": generator.render(name, schema)
        for name, schema in definitions.items()
    }
    files[target.factories / "index.ts"] = render_index(definitions)
    files[target.mocks / "index.ts"] = "export * from './factories'\n"
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if generated factories are stale")
    add_target_arguments(parser)
    arguments = parser.parse_args()

    outputs = [Output(SHARED_MOCKS, shared_files(), "shared mock helpers", generated_header(Path(__file__).name))]
    outputs += [
        Output(
            target.mocks,
            generated_files(target),
            f"{target.key} mock factories",
            generated_header(Path(__file__).name, target),
        )
        for target in resolve_targets(arguments)
    ]
    return check_outputs(outputs) if arguments.check else write_outputs(outputs)


if __name__ == "__main__":
    raise SystemExit(main())
