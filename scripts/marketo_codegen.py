"""Shared helpers for the Marketo Swagger code generators."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
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
FORMATTER = ROOT / "scripts" / "format-generated.mjs"


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


def is_type_alias(schema: dict[str, Any]) -> bool:
    """Whether a top-level definition has no members to render as an interface (#24).

    An array or a primitive, or an object that only declares `additionalProperties`,
    becomes `export type X = …`. A schema with `properties` or `allOf` stays an
    interface, and so does one that declares nothing at all, such as `Empty`.
    """
    if "properties" in schema or "allOf" in schema:
        return False
    schema_type = schema.get("type")
    if schema_type is not None and schema_type != "object":
        return True
    return "additionalProperties" in schema


_IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def property_key(name: str) -> str:
    """Quote keys that are not plain identifiers — Marketo ships names like `{fieldApiName}`."""
    return name if _IDENTIFIER.match(name) and name != "default" else json.dumps(name)


def quote(value: Any) -> str:
    """Render a JSON value as a single-quoted TypeScript literal."""
    if isinstance(value, str):
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"
    return json.dumps(value)


#: The Prettier the formatter imports: this repository's own, never one found above it. A bare
#: `import('prettier')` climbs to any node_modules above ROOT, such as the main checkout's (#29).
PRETTIER = ROOT / "node_modules" / "prettier" / "index.mjs"


def document_path(source: Path) -> str | None:
    """The document as written relative to the repository, without following links; None outside it.

    The repository is found by identity, not by spelling, so a path through a link or in another
    letter case on a case-insensitive disk still counts as inside it (#7).
    """
    written = Path(os.path.abspath(source))
    for parent in written.parents:
        if parent.exists() and os.path.samefile(parent, ROOT):
            return written.relative_to(parent).as_posix()
    resolved = source.resolve()
    return resolved.relative_to(ROOT).as_posix() if resolved.is_relative_to(ROOT) else None


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
    document = document_path(target.source)
    if target not in TARGETS.values():
        swagger = shlex.quote(document) if document else f"<path to {target.source.name}>"
        command += f" -- --swagger {swagger} --area {target.area}"
    return (
        f"// Code generated by scripts/{generator} from {document or target.source.name}. DO NOT EDIT.\n"
        f"// Change the generator or the Swagger document, then run `{command}`.\n\n"
    )


def _cannot_format(message: str) -> SystemExit:
    """Exit 2, not 1: the run could not judge the output, which is not the same as stale output."""
    print(message, file=sys.stderr)
    return SystemExit(2)


def _is_node(folder: Path) -> bool:
    """Whether `folder` holds a `node` this process could run."""
    node = folder / "node"
    return node.is_file() and os.access(node, os.X_OK)


def _node_environment() -> dict[str, str]:
    """NODE_BIN when set, else the node already in PATH, else the ~/.nvm one whose folder name sorts
    last, else a system one. The chosen folder goes first in PATH as an absolute path, because the
    formatter runs with cwd=ROOT and a relative entry would find another node, or none (#7)."""
    environment = os.environ.copy()
    in_path = shutil.which("node", path=environment.get("PATH"))
    if environment.get("NODE_BIN"):
        node_bin = Path(os.path.abspath(os.path.expanduser(environment["NODE_BIN"])))
        if not _is_node(node_bin):
            raise _cannot_format(
                f"Node.js not found in NODE_BIN ({environment['NODE_BIN']}), or not executable there: "
                "point it at the bin/ folder of the version in .nvmrc."
            )
        candidates = [node_bin]
    elif in_path:
        candidates = [Path(os.path.abspath(in_path)).parent]
    else:
        candidates = sorted((Path.home() / ".nvm" / "versions" / "node").glob("*/bin"), reverse=True)
        candidates += [Path("/usr/local/bin"), Path("/opt/homebrew/bin")]
    for candidate in candidates:
        if _is_node(candidate):
            environment["PATH"] = f"{candidate}{os.pathsep}{environment.get('PATH', '')}"
            break
    return environment


def prettier_environment() -> dict[str, str]:
    """Stop the run unless Prettier and a Node.js to run the formatter are available."""
    if not PRETTIER.is_file():
        raise _cannot_format(
            f"Prettier not found at {PRETTIER.parent.relative_to(ROOT)}: run `npm ci` first. "
            "The generators never write or compare unformatted code."
        )
    if not FORMATTER.is_file():
        raise _cannot_format(f"The formatter {FORMATTER.relative_to(ROOT)} is missing: restore it from git.")
    environment = _node_environment()
    if shutil.which("node", path=environment.get("PATH")) is None:
        raise _cannot_format(
            "Node.js not found in NODE_BIN, PATH, ~/.nvm, /usr/local/bin or /opt/homebrew/bin: Prettier needs it. "
            "Install the version in .nvmrc, or point NODE_BIN at its bin/ folder."
        )
    return environment


def format_files(files: dict[Path, str]) -> dict[Path, str]:
    """Every file formatted in memory by scripts/format-generated.mjs, with the Prettier config of its
    destination path: the one `npm run format:check` reads there (#29).

    Nothing is written here. write_outputs() and check_outputs() call this before they delete, write
    or compare anything, so a Prettier that fails leaves the output as it was, and generate and
    --check format the same text for the same path.
    """
    if not files:
        return {}
    environment = prettier_environment()
    node = shutil.which("node", path=environment.get("PATH"))
    ordered = sorted(files)
    payload = json.dumps([{"path": path.relative_to(ROOT).as_posix(), "content": files[path]} for path in ordered])
    try:
        result = subprocess.run(
            [str(node), str(FORMATTER)],
            input=payload,
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
        )
    except OSError as error:
        raise _cannot_format(f"Prettier could not run: {error}.") from None
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        raise _cannot_format(
            f"Prettier failed with exit code {result.returncode}. "
            "The generators never write or compare unformatted code, so nothing was touched."
        )
    try:
        formatted = json.loads(result.stdout)
    except json.JSONDecodeError:
        formatted = None
    if not isinstance(formatted, list) or len(formatted) != len(ordered) or not all(
        isinstance(text, str) for text in formatted
    ):
        raise _cannot_format(
            f"{FORMATTER.relative_to(ROOT)} did not return one formatted text for each of the "
            f"{len(ordered)} files, so nothing was touched."
        )
    return dict(zip(ordered, formatted))


@dataclass(frozen=True)
class Output:
    """One output folder of a generator run: the files it holds, what to call them, and their header."""

    folder: Path
    files: dict[Path, str]
    label: str
    header: str


def _formatted(outputs: list[Output]) -> dict[Path, str]:
    """Every file of the run, `header` included, formatted in one call to the formatter."""
    return format_files(
        {path: output.header + content for output in outputs for path, content in output.files.items()}
    )


def write_outputs(outputs: list[Output]) -> int:
    """Replace each output folder with its generated files, formatted.

    Every file of the run is formatted and encoded first, and every folder is cleared for writing next:
    a Prettier that fails, a text that is not valid UTF-8, or a folder that holds a file no generator
    writes, stops the run before any folder of it is deleted (#29).
    """
    formatted = _formatted(outputs)
    encoded: dict[Path, bytes] = {}
    for path, text in formatted.items():
        try:
            encoded[path] = text.encode("utf-8")
        except UnicodeEncodeError as error:
            raise SystemExit(
                f"{path.relative_to(ROOT)} cannot be written as UTF-8 ({error.reason}): fix the Swagger text "
                "it comes from. Nothing was touched."
            ) from None
    for output in outputs:
        if output.folder.exists():
            refuse_foreign_files(output.folder, output.files)
    for output in outputs:
        if output.folder.exists():
            shutil.rmtree(output.folder)
        for path in output.files:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(encoded[path])
        print(f"Generated {len(output.files)} {output.label}.")
    return 0


def check_outputs(outputs: list[Output]) -> int:
    """Compare each output folder with the text write_outputs() would write there, `header` included."""
    formatted = _formatted(outputs)
    # read_text() reads every line ending as \n, so the formatted text is read the same way: an
    # endOfLine of crlf or cr, or a checkout that rewrote the files with CRLF, still compares equal.
    expected = {path: text.replace("\r\n", "\n").replace("\r", "\n") for path, text in formatted.items()}
    status = 0
    for output in outputs:
        stale = [path for path in output.files if not path.is_file() or path.read_text() != expected[path]]
        unexpected = (
            [path for path in output.folder.rglob("*.ts") if path not in output.files]
            if output.folder.exists()
            else []
        )
        if stale or unexpected:
            for path in (stale + unexpected)[:10]:
                print(f"  stale or unexpected: {path.relative_to(ROOT)}")
            print(f"{output.label} are stale: {len(stale)} missing or changed, {len(unexpected)} unexpected.")
            status = 1
        else:
            print(f"All {len(output.files)} {output.label} are current.")
    return status


def write_or_check_outputs(outputs: list[Output], check: bool) -> int:
    """The last step of every generator: with --check, compare the outputs; without it, write them."""
    return check_outputs(outputs) if check else write_outputs(outputs)


def custom_target(swagger: Path, area: str) -> Target:
    """A target for an unregistered document, confined to its own folder directly under `src/`.

    write_outputs() deletes an area's output folders before writing, so `--area` may never name
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


def _registered_outputs() -> set[Path]:
    """The output folders of the registered targets and the shared mocks: all tracked by git."""
    return {SHARED_MOCKS} | {
        folder for target in TARGETS.values() for folder in (target.definitions, target.resources, target.mocks)
    }


def refuse_foreign_files(output: Path, files: dict[Path, str]) -> None:
    """Before an unregistered area's folder is deleted, check that it only holds files this run writes.

    A registered area's folders and the shared mocks are regenerated as a whole: a file the document
    no longer produces has to go. A folder named with `--area` may hold anything, so a file this run
    would not write again is refused instead of deleted.
    """
    if output in _registered_outputs():
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
