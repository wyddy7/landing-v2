# NetWho — AI CRM for a personal network

> Case Study · Side project

- **Canonical:** https://wyddy.tech/case-netwho.html
- **Role:** Solo · built end-to-end
- **Scope:** Bot · RAG · multi-tenant layer
- **Surface:** Telegram bot
- **Status:** Live demo — https://t.me/netwho_bot

A Telegram-native assistant for keeping a personal network live. Ask it in
natural language — who's working on what, who I should ping about X, what's been
happening with whom — and it answers from its own retrieval layer over contacts,
notes, and parsed news. Extended to multi-tenant — private and open communities
plug their own contact sets in with per-tenant RLS isolation.

## 01 · Context

Live in Telegram — question in, grounded answer out.

I know a lot of people and I lose track of what they're working on. A notebook
doesn't search, and a CRM is overkill for a personal network. What I wanted was
simpler: ask a question in plain language and get back the relevant person with
the context attached.

NetWho is that. It lives in Telegram, so I already have it open. Under the hood
it's a retrieval-augmented assistant: every contact becomes an embedded record,
every news event gets parsed and linked, and the reasoning loop ranks what matches
the question.

## 02 · Architecture

aiogram 3.x bot on the edge. Every contact is parsed into a **Pydantic v2 schema**
and stored with its embedding in **pgvector**. News items get pulled in via
**Jina AI**'s reader API, embedded, and linked back to contacts by entity overlap.
Queries run a semantic retrieval + reranking loop before generating a grounded
answer with source references.

Flow: `query → aiogram 3.x → embed query → {pgvector contacts, Jina AI news} → rerank + answer → reply`.

## 03 · What was built

- **Structured contact ingestion (schema):** Every contact lands through a Pydantic
  v2 schema — name, aliases, roles, companies, tags, notes. Validation happens at
  the boundary, not deep inside.
- **Semantic retrieval (pgvector):** Each contact and note gets embedded and stored
  in pgvector. Queries retrieve top-k by cosine similarity, so a question about
  "the guy working on LLM evals" hits the right record without exact name match.
- **News enrichment via Jina AI (freshness):** NetWho pulls fresh news via Jina's
  reader API, extracts entities, and links items back to existing contacts. So
  "what's new with Anna?" answers against this week, not last year's notes.
- **Reranking reasoning loop (relevance):** A rerank pass scores retrieved
  candidates against the actual question phrasing before composing the reply, so the
  model sees a tight context window of the most relevant few.
- **Grounded answers with sources (trust):** Every reply cites the records it drew
  from. It won't invent a contact or make up someone's job.

## 04 · Outcome

Shipped solo, live on Telegram as [@netwho_bot](https://t.me/netwho_bot). Used
daily for my own network management; every change merges to master and rolls out
from there.

**Takeaway:** Personal RAG is the cleanest way to learn production RAG: the dataset
is small enough to understand end-to-end, but every reasoning failure is something
you can feel. Once the single-user shape held up, the same schema → embeddings →
rerank → grounded-answer pipeline got lifted into a multi-tenant layer — private
and open communities bring their own contacts, per-tenant RLS keeps the boundaries
clean.

## 05 · Stack

- **Bot:** aiogram 3.x · Telegram Bot API · async handlers
- **Validation:** Pydantic v2 · structured schemas
- **Retrieval:** RAG · pgvector · reranking · grounded generation
- **External:** Jina AI reader · OpenRouter LLM · embedding models
- **Data:** Supabase · PostgreSQL

---

Related case study: [Video Generation Pipeline — rebuilt for throughput & cost](https://wyddy.tech/case-video-pipeline.html)

Want a personal RAG like this built for your own domain? Get in touch: https://t.me/wyddy7
