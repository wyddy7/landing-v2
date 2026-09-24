# Agent router — wyddy.tech

Before editing anything here, know the **cascade rule**:

- Every page `X.html` has a hand-authored markdown twin `X.html.md` (served as
  `text/markdown` for agents; advertised via `<link rel="alternate">` and
  `llms.txt`). Nothing regenerates them.
- **Change a page's content → update its `X.html.md` twin in the same commit.**
- A `pre-commit` hook (`scripts/pre-commit-cascade-guard.sh`) blocks commits that
  stage a page without its twin. Install: `bash scripts/install-hooks.sh`.
  CSS/markup-only edits with no content change: `git commit --no-verify`.

Full context: `auto-docs/landing-map.md` (Markdown-for-agents section) in the
parent monorepo. Stack: pure static HTML/CSS/JS, no build step, GitHub Pages.
