#!/usr/bin/env bash
# Install the cascade guard as this clone's pre-commit hook.
# Works for a normal clone AND for the submodule layout (gitdir is a file).
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
hooks_dir="$(git rev-parse --git-path hooks)"
mkdir -p "$hooks_dir"
ln -sf "$repo_root/scripts/pre-commit-cascade-guard.sh" "$hooks_dir/pre-commit"
chmod +x "$repo_root/scripts/pre-commit-cascade-guard.sh"
echo "✓ installed pre-commit cascade guard → $hooks_dir/pre-commit"
