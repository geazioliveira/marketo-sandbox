"""Shared helpers for the Marketo Swagger code generators."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
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


PRETTIER = ROOT / "node_modules" / ".bin" / "prettier"
#: What `prettier --write` prints for each file it processed; a file it skipped prints nothing.
_PROCESSED = re.compile(r"^(?P<path>.+) \d+ms(?: \(unchanged\))?(?: \(cached\))?$")


def _document_path(source: Path) -> str | None:
    """The document as written relative to the repository, without following links; None outside it."""
    for candidate in (Path(os.path.abspath(source)), source.resolve()):
        if candidate.is_relative_to(ROOT):
            return candidate.relative_to(ROOT).as_posix()
    return None


def generated_header(generator: str, target: Target | None = None) -> str:
    """The two comment lines every generated file opens with: who writes it, and how to change it.

    A registered target is regenerated by the npm script; an area written with --swagger and --area
    only by the same flags, so its header names them (#7).
    """
    command = f"npm run generate:{generator.removeprefix('generate-marketo-').removesuffix('.py')}"
    if target is None:
        return (
            f"// Code generated by scripts/{generator}. DO NOT EDIT.\n"
            f"// Change the generator, then run `{command}`.\n\n"
        )
    document = _document_path(target.source)
    if target not in TARGETS.values():
        command += f" -- --swagger {document or f'<path to {target.source.name}>'} --area {target.area}"
    return (
        f"// Code generated by scripts/{generator} from {document or target.source.name}. DO NOT EDIT.\n"
        f"// Change the generator or the Swagger document, then run `{command}`.\n\n"
    )


def _cannot_format(message: str) -> SystemExit:
    """Exit 2, not 1: the run could not judge the output, which is not the same as stale output."""
    print(message, file=sys.stderr)
    return SystemExit(2)


def _node_environment() -> dict[str, str]:
    """NODE_BIN when set, else the node already in PATH, else the ~/.nvm one whose folder name sorts
    last, else a system one. The chosen folder goes first in PATH as an absolute path, because Prettier
    runs with cwd=ROOT and a relative entry would find another node, or none (#7)."""
    environment = os.environ.copy()
    in_path = shutil.which("node", path=environment.get("PATH"))
    if environment.get("NODE_BIN"):
        node_bin = Path(os.path.abspath(os.path.expanduser(environment["NODE_BIN"])))
        if not (node_bin / "node").exists():
            raise _cannot_format(
                f"Node.js not found in NODE_BIN ({environment['NODE_BIN']}): "
                "point it at the bin/ folder of the version in .nvmrc."
            )
        candidates = [node_bin]
    elif in_path:
        candidates = [Path(os.path.abspath(in_path)).parent]
    else:
        candidates = sorted((Path.home() / ".nvm" / "versions" / "node").glob("*/bin"), reverse=True)
        candidates += [Path("/usr/local/bin"), Path("/opt/homebrew/bin")]
    for candidate in candidates:
        if (candidate / "node").exists():
            environment["PATH"] = f"{candidate}{os.pathsep}{environment.get('PATH', '')}"
            break
    return environment


def prettier_environment() -> dict[str, str]:
    """Stop the run unless Prettier and a Node.js to run it are available."""
    if not PRETTIER.exists():
        raise _cannot_format(
            f"Prettier not found at {PRETTIER.relative_to(ROOT)}: run `npm ci` first. "
            "The generators never write or compare unformatted code."
        )
    if not os.access(PRETTIER, os.X_OK):
        raise _cannot_format(
            f"Prettier at {PRETTIER.relative_to(ROOT)} is not executable: run `npm ci` again. "
            "The generators never write or compare unformatted code."
        )
    environment = _node_environment()
    # The experimental CLI formats without the per-file report the check below reads.
    environment.pop("PRETTIER_EXPERIMENTAL_CLI", None)
    if shutil.which("node", path=environment.get("PATH")) is None:
        raise _cannot_format(
            "Node.js not found in NODE_BIN, PATH, ~/.nvm, /usr/local/bin or /opt/homebrew/bin: Prettier needs it. "
            "Install the version in .nvmrc, or point NODE_BIN at its bin/ folder."
        )
    return environment


def format_with_prettier(paths: list[Path], output: Path | None = None) -> None:
    """Format `paths` in place, or stop the run if Prettier did not process every one of them.

    Prettier 3 reads .gitignore and .prettierignore by default and skips an ignored file without a
    word and with exit 0, even one named on the command line. `--ignore-path=` turns both off, so no
    ignore rule reaches generated code, and the per-file report proves nothing else skipped a path.
    `--no-color` keeps that report parseable under CI=true. `--no-require-pragma` and the whole-file
    range beat a config that would process a file without formatting it (#7). `output` names the
    folder write_output() already rewrote, so a failure says how to restore it.
    """
    if not paths:
        return
    restore = (
        f" {output.relative_to(ROOT).as_posix()} was rewritten unformatted: restore it with "
        f"`git checkout -- {output.relative_to(ROOT).as_posix()}` before committing."
        if output
        else ""
    )
    relative = [path.relative_to(ROOT).as_posix() for path in paths]
    command = [str(PRETTIER), "--write", "--no-color", "--no-require-pragma", "--range-start=0", "--range-end=Infinity"]
    try:
        result = subprocess.run(
            [*command, "--ignore-path=", *relative],
            cwd=ROOT,
            env=prettier_environment(),
            capture_output=True,
            text=True,
        )
    except OSError as error:
        raise _cannot_format(f"Prettier could not run: {error}.{restore}") from None
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        raise _cannot_format(f"Prettier failed with exit code {result.returncode}.{restore}")
    reported = {match["path"] for line in result.stdout.splitlines() if (match := _PROCESSED.match(line))}
    skipped = [path for path in relative if path not in reported]
    if skipped:
        raise _cannot_format(
            f"Prettier did not process {len(skipped)} of {len(paths)} files, e.g. {skipped[0]}: they are "
            "missing from the per-file report of `prettier --write`, so an ignore rule, a Prettier config "
            f"or a Prettier CLI that reports differently is skipping them.{restore}"
        )


def write_output(output: Path, files: dict[Path, str], label: str, header: str) -> int:
    """Write generated files, each opening with `header`, then normalise them with prettier."""
    prettier_environment()  # fail before deleting anything
    if output.exists():
        refuse_foreign_files(output, files)
        shutil.rmtree(output)
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(header + content)
    format_with_prettier(sorted(files), output)
    print(f"Generated {len(files)} {label}.")
    return 0


def check_output(output: Path, files: dict[Path, str], label: str, header: str) -> int:
    """Compare committed files against freshly generated, prettier-formatted output, `header` included."""
    prettier_environment()  # fail before comparing anything
    if TEMP.exists():
        shutil.rmtree(TEMP)
    try:
        staged: dict[Path, Path] = {}
        for path, content in files.items():
            temporary = TEMP / path.relative_to(ROOT)
            temporary.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(header + content)
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
    """A target for an unregistered document, confined to its own folder directly under `src/`.

    write_output() deletes an area's output folders before writing, so `--area` may never name
    a registered area, the shared mocks, a path that leaves `src/`, or a folder holding anything
    but the three generator folders. Those three stay allowed, so the generators can fill the
    area one after another, regenerate it and check it.
    """
    taken = {registered.area for registered in TARGETS.values()} | {SHARED_MOCKS.name}
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", area) or area in taken:
        raise SystemExit(
            f"--area must name a new kebab-case folder under src/, not a path, a registered area or 'mocks': {area!r}"
        )
    target = Target(area, area, swagger)
    generated = {target.definitions.name, target.resources.name, target.mocks.name}
    if target.root.exists() and (
        not target.root.is_dir()
        or any(entry.name not in generated for entry in target.root.iterdir() if not entry.name.startswith("."))
    ):
        raise SystemExit(f"src/{area} already holds something no generator writes; pick a new --area: {area!r}")
    return target


def refuse_foreign_files(output: Path, files: dict[Path, str]) -> None:
    """Before an unregistered area's folder is deleted, check that it only holds files this run writes.

    A registered area's folders and the shared mocks are regenerated as a whole: a file the document
    no longer produces has to go. A folder named with `--area` may hold anything, so a file this run
    would not write again is refused instead of deleted.
    """
    registered = {SHARED_MOCKS} | {
        folder for target in TARGETS.values() for folder in (target.definitions, target.resources, target.mocks)
    }
    if output in registered:
        return
    foreign = sorted(
        path.relative_to(ROOT)
        for path in output.rglob("*")
        if path.is_file() and path not in files and not path.name.startswith(".")
    )
    if foreign:
        listed = ", ".join(str(path) for path in foreign[:5])
        raise SystemExit(
            f"{output.relative_to(ROOT)} holds files this run would not write again ({listed}); "
            "move them or pick a new --area."
        )
