# wyddy.tech

Personal portfolio landing — static HTML, deployed to GitHub Pages via GitHub Actions.

## Structure

```
index.html               — main portfolio page
case-netwho.html         — NetWho case study
case-video-pipeline.html — Video pipeline case study
assets/                  — favicons, Open Graph images, demo media
robots.txt / llms.txt / sitemap.xml
.well-known/             — agent skills index
```

## Editing — cascade rule (read this first)

Every public page `X.html` ships with a markdown twin `X.html.md`, served by
GitHub Pages as `Content-Type: text/markdown` so AI agents can read a clean
version (see `auto-docs/landing-map.md` → "Markdown for agents"). The twins are
**hand-authored — nothing regenerates them.**

**So: when you change a page's CONTENT, change its `.html.md` twin in the same
commit.** A `pre-commit` hook enforces this — it blocks a commit that stages
`X.html` without `X.html.md`. CSS/markup-only edits (no content change) can skip
it with `git commit --no-verify` after checking your diff.

Install the hook once per clone:

```bash
bash scripts/install-hooks.sh
```

## Deploy

Push to `master` → GitHub Actions deploys to GitHub Pages → wyddy.tech.
