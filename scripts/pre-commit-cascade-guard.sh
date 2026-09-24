#!/usr/bin/env bash
#
# Cascade guard for wyddy.tech — keeps each page's markdown twin in sync.
#
# WHY: every public page X.html has a markdown twin X.html.md (served by GitHub
# Pages as text/markdown for AI agents — see auto-docs/landing-map.md "Markdown
# for agents"). The twins are hand-authored; NO generator keeps them in sync.
# If you change a page's CONTENT and forget its twin, agents read stale copy.
#
# RULE: if X.html is staged but its X.html.md twin is NOT staged, block the
# commit. Pure CSS/markup edits don't change content — bypass with --no-verify
# after eyeballing your diff.
#
# Install (per clone; hooks aren't versioned by git):
#   ln -sf ../../scripts/pre-commit-cascade-guard.sh "$(git rev-parse --git-path hooks)/pre-commit"
# (for a submodule the relative depth differs — the installer below uses an
#  absolute path, so prefer: scripts/install-hooks.sh)

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

staged="$(git diff --cached --name-only --diff-filter=ACM)"

violations=()
missing_twin=()

while IFS= read -r f; do
  # only top-level page files: *.html (skip the twins themselves)
  case "$f" in
    *.html.md) continue ;;
    */*) continue ;;            # only repo-root pages
    *.html) ;;
    *) continue ;;
  esac

  twin="${f}.md"
  if [ ! -f "$twin" ]; then
    missing_twin+=("$f")
    continue
  fi
  if ! grep -qxF "$twin" <<<"$staged"; then
    violations+=("$f  →  $twin")
  fi
done <<<"$staged"

fail=0

if [ "${#violations[@]}" -gt 0 ]; then
  fail=1
  echo "✗ cascade-guard: page changed but its markdown twin is NOT staged:" >&2
  for v in "${violations[@]}"; do echo "    $v" >&2; done
  echo "" >&2
  echo "  Update the twin so agents don't read stale content, then re-stage it." >&2
  echo "  If this was a CSS/markup-only change (no content): git commit --no-verify" >&2
fi

if [ "${#missing_twin[@]}" -gt 0 ]; then
  fail=1
  echo "✗ cascade-guard: page has no markdown twin (create <page>.html.md):" >&2
  for m in "${missing_twin[@]}"; do echo "    $m  →  ${m}.md" >&2; done
  echo "  Every public page needs a twin (see auto-docs/landing-map.md)." >&2
fi

exit "$fail"
