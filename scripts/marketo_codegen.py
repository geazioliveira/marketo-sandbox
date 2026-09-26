"""Shared helpers for the Marketo Swagger code generators."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SRC = ROOT / "src"
#: Seeding and request-id helpers are area-agnostic, so every target shares one copy.
SHARED_MOCKS = SRC / "mocks"
TEMP = ROOT / ".codegen-tmp"


@dataclass(frozen=True)
class Target:
    """A Swagger document paired with the `src/` area its output belongs to."""

    key: str
    area: str
    source: Path

    @property
    def root(self) -> Path:
        return SRC / self.area

    @property
    def definitions(self) -> Path:
        return self.root / f"{self.area}-definitions"

    @property
    def mocks(self) -> Path:
        return self.root / f"{self.area}-mocks"

    @property
    def factories(self) -> Path:
        return self.mocks / "factories"

    @property
    def resources(self) -> Path:
        return self.root / "resources"

    def document(self) -> dict[str, Any]:
        return json.loads(self.source.read_text())

    def schemas(self) -> dict[str, dict[str, Any]]:
        """Swagger 2.0 keeps schemas in `definitions`, OpenAPI 3 in `components.schemas`."""
        document = self.document()
        return document.get("definitions") or document.get("components", {}).get("schemas", {})


TARGETS: dict[str, Target] = {
    target.key: target
    for target in (
        Target("asset", "asset", DOCS / "marketo-swagger-asset.json"),
        Target("data-ingestion", "data-ingestion", DOCS / "marketo-swagger-data-ingestion.json"),
        Target("identity", "identity", DOCS / "marketo-swagger-identity.json"),
        Target("mapi", "lead-database", DOCS / "marketo-swagger-mapi.json"),
        Target("user", "user-management", DOCS / "marketo-swagger-user.json"),
    )
}

ASSET = TARGETS["asset"]


def add_target_arguments(parser: argparse.ArgumentParser) -> None:
    """Register the flags used to pick which Swagger documents to generate from."""
    parser.add_argument(
        "--target",
        nargs="+",
        default=["all"],
        choices=["all", *TARGETS],
        help="which registered Swagger documents to generate from (default: all)",
    )
    parser.add_argument("--swagger", type=Path, help="path to an unregistered Swagger or OpenAPI document")
    parser.add_argument("--area", help="folder under src/ receiving the output of --swagger")


def resolve_targets(arguments: argparse.Namespace) -> list[Target]:
    if arguments.swagger or arguments.area:
        if not (arguments.swagger and arguments.area):
            raise SystemExit("--swagger and --area must be used together.")
        if not arguments.swagger.is_file():
            raise SystemExit(f"Swagger document not found: {arguments.swagger}")
        return [custom_target(arguments.swagger, arguments.area)]

    keys = list(TARGETS) if "all" in arguments.target else list(dict.fromkeys(arguments.target))
    return [TARGETS[key] for key in keys]


def load_document(source: Path | None = None) -> dict[str, Any]:
    return json.loads((source or ASSET.source).read_text())


HTTP_METHODS = ("get", "post", "put", "patch", "delete")


def operations(document: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    """Yield every (method, path, operation) triple in the document."""
    return [
        (method, path, operation)
        for path, path_item in document["paths"].items()
        for method, operation in path_item.items()
        if method in HTTP_METHODS
    ]


def media_schema(container: dict[str, Any]) -> dict[str, Any] | None:
    """Read a schema from either a Swagger 2.0 `schema` or an OpenAPI 3 `content` map."""
    if schema := container.get("schema"):
        return schema
    content = container.get("content") or {}
    for media_type in ("application/json", "*/*"):
        if media_type in content:
            return content[media_type].get("schema")
    return next((value.get("schema") for value in content.values() if value.get("schema")), None)


def operation_parameters(operation: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalise parameters so OpenAPI 3 `requestBody` looks like a Swagger 2.0 body parameter."""
    parameters = list(operation.get("parameters", []))
    request_body = operation.get("requestBody")
    if request_body and (schema := media_schema(request_body)):
        parameters.append(
            {
                "name": "body",
                "in": "body",
                "required": request_body.get("required", False),
                "schema": schema,
            },
        )
    return parameters


def success_schemas(operation: dict[str, Any]) -> list[dict[str, Any]]:
    """Schemas of every 2xx response, in declaration order."""
    return [
        schema
        for status, response in operation.get("responses", {}).items()
        if status.startswith("2") and (schema := media_schema(response)) is not None
    ]


def relative_import(source: Path, target: Path) -> str:
    """Build the extensionless relative specifier importing `target` from inside `source`."""
    path = os.path.relpath(target.with_suffix(""), source)
    return path if path.startswith(".") else f"./{path}"


def kebab_case(value: str) -> str:
    normalized = value.replace("(", "").replace(")", "")
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", normalized)
    normalized = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1-\2", normalized)
    return re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()


def pascal_case(value: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in re.findall(r"[A-Za-z0-9]+", value))


def camel_case(value: str) -> str:
    parts = re.findall(r"[A-Za-z0-9]+", value)
    if not parts:
        return "value"
    return parts[0][:1].lower() + parts[0][1:] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def definition_category(name: str) -> str:
    if name.endswith("Request"):
        return "requests"
    # Marketo names envelopes both ways: `ChannelResponse` and `ResponseOfIdentity`.
    if name.endswith("Response") or name.startswith("ResponseOf"):
        return "responses"
    return "models"


def definition_file(name: str) -> str:
    return re.sub(
        r"([a-z0-9])([A-Z])",
        r"\1-\2",
        re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1-\2", name),
    ).lower()


def reference_name(reference: str) -> str:
    return reference.rsplit("/", maxsplit=1)[-1]


_IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def property_key(name: str) -> str:
    """Quote keys that are not plain identifiers — Marketo ships names like `{fieldApiName}`."""
    return name if _IDENTIFIER.match(name) and name != "default" else json.dumps(name)


def quote(value: Any) -> str:
    """Render a JSON value as a single-quoted TypeScript literal."""
    if isinstance(value, str):
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"
    return json.dumps(value)


def _node_environment() -> dict[str, str]:
    environment = os.environ.copy()
    candidates = [Path(environment.get("NODE_BIN", ""))] if environment.get("NODE_BIN") else []
    candidates.extend(sorted((Path.home() / ".nvm" / "versions" / "node").glob("*/bin"), reverse=True))
    candidates.extend([Path("/usr/local/bin"), Path("/opt/homebrew/bin")])
    for candidate in candidates:
        if candidate and (candidate / "node").exists():
            environment["PATH"] = f"{candidate}{os.pathsep}{environment.get('PATH', '')}"
            break
    return environment


def format_with_prettier(paths: list[Path]) -> None:
    prettier = ROOT / "node_modules" / ".bin" / "prettier"
    if not prettier.exists() or not paths:
        return
    # Prettier 3 also reads .gitignore, which lists .codegen-tmp/: --check would compare
    # unformatted output against formatted files. Only .prettierignore may skip a path.
    subprocess.run(
        [str(prettier), "--write", "--log-level", "warn", "--ignore-path", ".prettierignore"]
        + [str(path) for path in paths],
        check=True,
        cwd=ROOT,
        env=_node_environment(),
    )


def write_output(output: Path, files: dict[Path, str], label: str) -> int:
    """Write generated files, then normalise them with prettier."""
    if output.exists():
        shutil.rmtree(output)
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    format_with_prettier(sorted(files))
    print(f"Generated {len(files)} {label}.")
    return 0


def check_output(output: Path, files: dict[Path, str], label: str) -> int:
    """Compare committed files against freshly generated, prettier-formatted output."""
    if TEMP.exists():
        shutil.rmtree(TEMP)
    try:
        staged: dict[Path, Path] = {}
        for path, content in files.items():
            temporary = TEMP / path.relative_to(ROOT)
            temporary.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(content)
            staged[path] = temporary
        format_with_prettier(sorted(staged.values()))

        stale = [
            path
            for path, temporary in staged.items()
            if not path.is_file() or path.read_text() != temporary.read_text()
        ]
        unexpected = [path for path in output.rglob("*.ts") if path not in files] if output.exists() else []
        if stale or unexpected:
            for path in (stale + unexpected)[:10]:
                print(f"  stale or unexpected: {path.relative_to(ROOT)}")
            print(f"{label} are stale: {len(stale)} missing or changed, {len(unexpected)} unexpected.")
            return 1
        print(f"All {len(files)} {label} are current.")
        return 0
    finally:
        if TEMP.exists():
            shutil.rmtree(TEMP)


def custom_target(swagger: Path, area: str) -> Target:
    """A target for an unregistered document, confined to a new folder directly under `src/`.

    write_output() deletes an area's output folders before writing, so `--area` may never name
    a registered area, the shared mocks or a path that leaves `src/`.
    """
    taken = {target.area for target in TARGETS.values()} | {SHARED_MOCKS.name}
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", area) or area in taken:
        raise SystemExit(
            f"--area must name a new kebab-case folder under src/, not a path, a registered area or 'mocks': {area!r}"
        )
    return Target(area, area, swagger)
