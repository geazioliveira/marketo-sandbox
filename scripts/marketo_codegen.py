"""Shared helpers for the Marketo Swagger code generators."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "marketo-swagger-asset.json"
TEMP = ROOT / ".codegen-tmp"


def load_document() -> dict[str, Any]:
    return json.loads(SOURCE.read_text())


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
    if name.endswith("Response"):
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
    subprocess.run(
        [str(prettier), "--write", "--log-level", "warn", *[str(path) for path in paths]],
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
