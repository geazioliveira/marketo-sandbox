#!/bin/sh
# A hook that cannot start fails open in Claude Code; exit 2 blocks instead.
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
script="$dir/$1.mjs"
[ -n "$1" ] && [ -f "$script" ] || { printf 'hooks do loop: %s ausente em %s\n' "$1" "$dir" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { printf 'hooks do loop: node ausente\n' >&2; exit 2; }
exec node "$script"
