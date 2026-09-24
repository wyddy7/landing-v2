# Browd — an AI agent that operates your browser for you

> Case Study · Open source

- **Canonical:** https://wyddy.tech/case-browd.html
- **Role:** Solo · built end-to-end
- **Scope:** Agent runtime · UI/UX · distribution
- **Surface:** Chrome extension (MV3)
- **Status:** Live · Chrome Web Store

An open-source AI agent that runs multi-step browser tasks — research,
extraction, navigation, form-filling — in your own browser session, on your own
keys. No hosted cloud, no subscription.

- Install from the Chrome Web Store: https://chromewebstore.google.com/detail/browd-ai-browser-agent/kgjeibjpgopjomghegdpelbnjgmddobb
- View source: https://github.com/wyddy7/browd

## 01 · Context

A real 32-second run — asked for the top-3 open-source models on a live
leaderboard, start to finish.

You give it a task in plain language — say, *"find the top-3 open-source models on
this leaderboard"* or *"pull this arXiv abstract and summarize it"* — and it works
through real pages to get there: clicking, typing, scrolling, reading. It lives in
a Chrome side panel and acts in your live session, so nothing is handed off to a
vendor's cloud.

The engineering challenge is reliability — keeping the model from going off the
rails in a live browser. It has to recognize when it's stuck instead of looping
forever, stay clear of your other tabs, and refuse instructions a web page tries
to feed it. That reliability-and-trust layer is **most of what's below**.

## 02 · Architecture

The agent runs as a **LangGraph.js** state machine in a plan-and-execute shape: a
planner breaks the task into concrete steps, an agent node executes each one with
browser tools — click, type, scroll, navigate, read, extract, plus web search and
fetch — and a **replanner** adapts the plan when a step fails instead of grinding
on a dead path. The whole loop lives inside the extension's **MV3 service
worker**, on your machine.

Two design choices keep it safe. The agent works in **its own tab**; your other
tabs are passed to the model as metadata only, never a surface it can act on
without asking. And every piece of third-party text — page content, search
snippets, fetched articles — is **wrapped before it reaches the model**, so a page
can't smuggle in instructions of its own.

Flow: `task → planner → agent (click · type · scroll · read · fetch) → replanner → result`,
with the replanner adapting back to the agent on failure.

## 03 · What I built

- **A chat-first surface (UI/UX):** Redesigned the whole panel — a chat composer
  with a quick model picker, a live status strip that shows what the agent is doing
  as it happens, a permission-mode selector, and a token-usage ring. Minimal
  affordances — left-rule accents, no card chrome — and localized into 7 languages.
- **A plan-and-execute agent runtime (runtime):** Rebuilt the loop into a planner /
  agent / replanner state machine on LangGraph.js, with vision, running inside the
  MV3 service worker.
- **An agent that stays in its lane (trust):** Tab isolation (the agent gets its
  own tab; yours are metadata), an explicit permission prompt before it ever takes
  over a tab you're on, and untrusted-content wrapping on every external text
  source — the OWASP LLM07 prompt-injection class, handled by default.
- **Shipped, not just built (distribution):** README, changelog, an eval suite
  that gates releases, an Apache-2.0 license, and a live Chrome Web Store listing
  anyone installs in one click.

## 04 · Under the hood

Most of the work was making the agent behave in a hostile, live environment. A
sample of the failures hit in real runs and what each one took to fix:

- **It bashed the same wall for 15 minutes (fresh-state verify):** The loop checked
  a cached snapshot, so every successful click looked like a no-op and the agent
  retried forever. Now every post-action check reads live DOM state, with a hard
  stop after repeated no-progress and a scroll fallback for single-page apps.
- **The model ignored "stop after N steps" (state budgets):** Prompt-level caps are
  advisory; a model under pressure blows past them. Budgets moved into the graph
  itself — real counters that return a forcing error when exhausted — so a runaway
  task stops deterministically.
- **A web page could tell the agent what to do (injection guard):** Every
  third-party text now passes through a wrapper that fences it as data, not
  commands, before it reaches the model.
- **It grabbed a tab I was using (consent):** Now it confines itself to its own tab
  group and asks for explicit permission before touching anything of yours.
- **The fix was deleting my own code (corrected against the field):** A "stuck
  detector" was killing agents that were actually finishing — a no-tool-call turn is
  how this class of agent signals it's done. Checked the behaviour against five
  production systems (browser-use, Anthropic computer-use, OpenAI Operator,
  Magentic-One, Stagehand), confirmed it was wrong, and removed it.

## 05 · Outcome

Live on the Chrome Web Store — one-click install, no account needed. **27.6k
lines** of TypeScript, **224** tests, and an eval suite that gates every release.
Thirteen runtime decisions that didn't generalize are written up as lessons, so
the next ones come cheaper.

**Takeaway:** The interesting work in browser agents isn't the model — it's
everything that keeps the model honest in a live, hostile environment. Stuck
loops, runaway budgets, injected instructions, a tab grabbed without consent:
solving those is what turns a demo into an agent you'd actually run.

## 06 · Stack

- **Agent:** LangGraph.js · StateGraph · plan-and-execute · vision
- **Browser:** Chrome DevTools Protocol · puppeteer-core · MV3 service worker
- **UI:** React · Vite · Tailwind
- **Language · build:** TypeScript · Turbo · pnpm
- **Models:** OpenRouter · bring-your-own-key · multi-provider

Open source under Apache-2.0, built on the Nanobrowser project — substantially
rewritten since (≈17k lines changed). Source: https://github.com/wyddy7/browd

---

Related case study: [NetWho — AI CRM for a personal network](https://wyddy.tech/case-netwho.html)

Want an agent system built for your domain? Get in touch: https://t.me/wyddy7
