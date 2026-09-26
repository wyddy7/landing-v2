# Daniil Makeev — Senior AI / LLM Engineer

> Senior AI / LLM Engineer. Builds production AI agents, RAG pipelines and content-generation systems — end to end.

- **Canonical:** https://wyddy.tech/
- **Role:** Senior AI Engineer · LLM Engineer
- **Tagline:** I build and ship AI agents and RAG systems end to end.
- **Availability:** Open to full-time or contract · remote · relocation

## About

I'm an AI / LLM engineer based in Yerevan, Armenia, with five years in software
engineering — open to remote or relocation across EU/US timezones.

I've been at [hao.vc](https://hao.vc), a Product AI lab, working across production delivery and applied
R&D, where I led a [video pipeline](https://wyddy.tech/case-video-pipeline.html)
to **6× faster output at 60% lower cost**. Below are selected systems I've built
and maintained across production delivery, applied R&D and open-source
engineering — an open-source [browser agent](https://wyddy.tech/case-browd.html),
a multi-tenant contact RAG, a personalized news digest. Before hao.vc: backend and
applied-AI engineering at EPAM and Zenit-Electro.

## Experience

**Senior AI / LLM engineer** · 5 years in software
Yerevan, Armenia (UTC+4) · available immediately · remote contract (B2B) or relocation · EAEU work authorization · English B2

Production LLM systems: agents, RAG, evals and the resilience layer around
non-deterministic AI providers. Led a video generation pipeline to **6× faster
output at 60% lower cost**.

### hao.vc — Senior Applied AI Engineer / Tech Lead · Jan 2025 – present

Product AI lab running several products in parallel.

- **Architected the end-to-end multimodal video pipeline** and owned AI provider selection (OpenAI, ElevenLabs, Google Imagen) and the monthly provider API budget: latency 6× (~60 → ~10 min), cost −60% ($2.00 → $0.80 per video), 800K+ organic views.
- **Built the resilience layer** around non-deterministic providers: retries with backoff, fallback routing, media validation and auto-repair of malformed structured outputs with Pydantic v2; 200+ automated tests.
- **Owned the AI video-generation pipeline end-to-end**, driving the engineering side of a ~6-person cross-functional product team (AI, infrastructure, content, growth).
- **Delivered a B2B EdTech project** through the lab: an interview-scheduling Telegram Mini App on FastAPI and PostgreSQL with CI/CD, used by ~700 students.
- **Own open-source R&D** (Browd, NetWho) — agentic patterns and architecture I carried into the production pipeline; production code stays under NDA.

### Zenit-Electro — Backend / Applied AI Engineer · Jun 2023 – Dec 2024

Metrological equipment supply and engineering.

- **Python / SQL ETL pipelines** for catalog automation and data validation, saving ~8–12 manual hours a week.
- Designed and built a prototype of a **local LLM assistant** for internal search across the product catalog and measurement documentation (RAG, structured outputs).

### EPAM Systems — Software Engineer (Backend) · Oct 2021 – Jun 2023

Intern / Junior Python Engineer → Middle Backend Engineer. Enterprise e-commerce and fintech, distributed teams of 10–15.

- **High-concurrency REST microservices** on FastAPI, PostgreSQL and asyncio.
- **Async data processing and integrations:** fiscalization services, retries, transaction cancellation.
- **Classical NLP** (spaCy, transformers / BERT) for entity extraction in enterprise documents.

### BMSTU — Education

BSc Computer Engineering / Computer Systems

Full CV (PDF): https://wyddy.tech/makeev-daniil-cv-en.pdf

## Projects

### Browd — browser-resident AI agent

A Chrome side-panel agent that runs multi-step tasks inside your real browser
session — no headless cloud, no credential copy-paste. LangGraph.js
plan-and-execute with per-tool state budgets, tab isolation, prompt-injection
guards on every third-party text source.

- **Status:** Live on the Chrome Web Store · open-source, Apache-2.0
- **Stack:** TypeScript · LangGraph.js · MV3 service worker · puppeteer-core · React
- Install: https://chromewebstore.google.com/detail/browd-ai-browser-agent/kgjeibjpgopjomghegdpelbnjgmddobb
- Source: https://github.com/wyddy7/browd
- Case study: https://wyddy.tech/case-browd.html

### NetWho — multi-tenant contact RAG

An AI assistant for personal and organizational networks. Multi-tenant with
per-tenant RLS isolation, semantic search over embeddings, news parsing, and a
reranking loop that grounds answers in source records.

- **Status:** Live on Telegram — you can message it yourself
- **Stack:** RAG · pgvector · reranking · aiogram · Supabase
- Try: https://t.me/netwho_bot
- Source: https://github.com/wyddy7/netwho
- Case study: https://wyddy.tech/case-netwho.html

### Digest Bot — personalized news digest

Reads your channels — fetching the article behind link-only posts — and writes
one summary tuned to your focus. A deterministic pipeline produces the daily
digest; a separate stateful chat agent (LangGraph, checkpointed to Supabase)
answers follow-ups.

- **Status:** Live · running daily
- **Stack:** LangGraph · Supabase checkpointer · OpenRouter · python-telegram-bot · Docker
- Source: https://github.com/wyddy7/claude-digest
- Case study: https://wyddy.tech/case-digest.html

## Skills

- **AI / ML:** RAG · Vector search · Reranking · Grounded generation · Structured outputs · LLM deduplication
- **Frameworks:** FastAPI · LangGraph · PydanticAI · aiogram · python-telegram-bot · deepagents
- **Data:** PostgreSQL · Supabase · pgvector · Pydantic v2 · AsyncIO · httpx
- **Platforms:** OpenRouter · OpenAI · ElevenLabs · Jina AI · S3 (boto3)
- **DevOps:** Docker · docker-compose · GitHub Actions · uv · Linux
- **Languages:** Python · SQL · TypeScript · English B2 · Russian native

## Contact

Every system here is live and still running. If that's the kind of engineer
your team is missing:

- Telegram (primary): https://t.me/wyddy7
- Email: wyddy.work@gmail.com
- GitHub: https://github.com/wyddy7
- LinkedIn: https://www.linkedin.com/in/daniil-makeev/
- X: https://x.com/wyddy7
- CV (PDF): https://wyddy.tech/makeev-daniil-cv-en.pdf
