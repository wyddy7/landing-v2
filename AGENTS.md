# Agent router — wyddy.tech

Before editing anything here, know the **cascade rule**:

- Every page `X.html` has a hand-authored markdown twin `X.html.md` (served as
  `text/markdown` for agents; advertised via `<link rel="alternate">` and
  `llms.txt`). Nothing regenerates them.
- **Change a page's content → update its `X.html.md` twin in the same commit.**
- A `pre-commit` hook (`scripts/pre-commit-cascade-guard.sh`) blocks commits that
  stage a page without its twin. Install: `bash scripts/install-hooks.sh`.
  CSS/markup-only edits with no content change need no twin update; if that hook
  objects, fix the hook — never `--no-verify`, which also switches off the hooks below.

Articles (`articles/<slug>/`) are generated: the page, its twin and its images are
copied in by a publish script from the article's source package in the parent monorepo.
Edit the source there and republish — a hand edit here is overwritten. The list page
`articles/index.html` (+ twin), `llms.txt` and `sitemap.xml` are hand-kept: a new article
goes into all three.

## Commits — this repo is public

- Everything here is public: commits, messages, branch names, PR titles and bodies.
- Iterate locally; push **one squashed commit per change set**.
- A message says **what changed on the page** — not where the wording came from, who
  decided it, or which attempt it is.
- Local hooks check commit contents for personal data and commit messages for process
  words. Do not bypass them with `--no-verify`.

Full context: `auto-docs/projects/landing/map.md` (Markdown-for-agents section) in the
parent monorepo. Stack: pure static HTML/CSS/JS, no build step, GitHub Pages.
