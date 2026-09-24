# Digest Bot — your channels, distilled to 60 seconds a day

> Case Study · Live · self-hosted

- **Canonical:** https://wyddy.tech/case-digest.html
- **Role:** Solo · built end-to-end
- **Scope:** Reader · selection · output · chat · cost
- **Surface:** Telegram bot
- **Status:** Live · running daily

Follow 10–15 Telegram channels without the 30-minute scroll. Digest reads them
for you and boils the day into one morning read, tuned to what you care about: the
substance inline, not a list of links to chase. Want more on something? Ask it.

## 01 · Context

One real digest, start to finish — source-attributed bullets with inline insights,
a "Personally for you" section, and a receipt of what it checked. A few messages;
one read.

I follow more channels than I can read. Most days I skim, miss what mattered, and
still lose half an hour scrolling. I wanted the opposite: **one read** in the
morning — the real substance of everything worth knowing — and done.

The naive version — paste the posts together, ask an LLM to summarize — produces a
bland wall nobody reads: dominated by whichever channel posted most, padded with
ads, blind to the article sitting behind a link. Each of those is a separate piece
of plumbing to fix, and that plumbing is most of what the project actually is.

## 02 · Architecture

A **deterministic pipeline**, not an agent. Each post is screened by a cheap model
for ads; links worth opening are fetched and read down to the article text; posts
are selected with **per-source fairness** so no single channel dominates; then one
stronger model writes the digest, tuned to your profile. Every stage has an
explicit model and token budget, and the whole path is offline-testable — no agent
framework on the thing that has to run reliably every single day.

Flow: `channels → ad-filter (cheap) → reader (fetch) → select (fair) → write (strong) → you`.

## 03 · What I built

- **A reader that goes behind the link (reader):** A cheap triage call decides which
  links are worth opening; then a fixed fetch → resolve-one-hop → extract pipeline
  pulls the actual article text. A channel that only posts headlines and links
  becomes real content in the digest.
- **Fair selection across sources (selection):** Per-source fairness and tiering in
  the picker, so one high-volume channel can't monopolize the digest. A bounded set
  of body items plus a compressed tail.
- **Read-and-go output (output):** The digest carries the facts inline plus a short
  "what this means for you" — you read the message and you're done. The message is
  the product.
- **Ask it follow-ups (chat agent):** On top of the daily digest sits a stateful
  conversational agent (deepagents / LangGraph): ask "more on this" or "what did I
  miss last week?" and it answers from your digest history, with conversation state
  checkpointed to Supabase so the thread survives a restart.
- **Cost-aware by stage (cost):** A per-stage model registry: cheap models for
  ad-filter and triage, a stronger one only for the final write, each with explicit
  token caps and structured cost logging.

## 04 · Under the hood

Most of the decisions that make a digest worth opening happen before the summary
call ever runs:

- **"A summary nobody reads" (read-and-go):** A generic roundup gets skimmed once
  and abandoned. Pulling facts inline, adding a so-what, and cutting the tap-out
  turns it into something read daily.
- **"One loud channel drowned the rest" (fairness):** Per-source fairness and
  tiering cap any one source's share, so a quiet channel's one good post still
  surfaces.
- **"A link channel was just headlines" (1-hop read):** A bounded fetch-and-extract
  reads the article behind the link, so those posts contribute substance.
- **"Ads in the digest" (cached filter):** A cheap binary ad-classifier runs before
  anything expensive, and its verdict is cached per post — so the same post is never
  paid for twice.
- **"Cost crept up per digest" (model tiering):** The strong model writes;
  everything upstream runs on cheap models with hard token caps. Cost is logged per
  stage, so a regression is visible the next day.

## 05 · Outcome

Live and self-hosted, delivering a digest every day. Built solo end-to-end, and
it's the thing I actually open in the morning instead of the channels.

**Takeaway:** A digest lives or dies on the unglamorous parts around the summary: a
reader that opens the link instead of quoting the headline, a picker that won't let
one loud channel bury the rest, an ad filter that runs before anything costs money,
and an output you finish inside the message. Get those right and it gets opened
again tomorrow — for something daily, the only test that counts.

## 06 · Stack

- **Bot:** python-telegram-bot · async
- **Pipeline:** deterministic stages · dependency injection · offline-testable
- **Reader:** trafilatura · fetch + 1-hop resolve
- **Models:** OpenRouter · multi-model registry · token caps
- **Chat agent:** deepagents · LangGraph · Supabase checkpointer
- **Data · deploy:** Supabase · Docker · self-hosted

Open source under AGPL-3.0. Source: https://github.com/wyddy7/claude-digest

---

Related case study: [Browd — an AI agent that operates your browser](https://wyddy.tech/case-browd.html)

Want a digest like this built for your team or domain? Get in touch: https://t.me/wyddy7
