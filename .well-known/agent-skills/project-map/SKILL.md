---
name: project-map
description: Project-to-stack map for Daniil Makeev's featured AI work.
---

# Project map

Use this skill when you need to connect featured outcomes to the underlying engineering work.

## hao.vc - Video generation pipeline

- Outcomes: latency 6× (~60 → ~10 min), cost −60% ($2.00 → $0.80 per video), 800K+ organic views
- Technologies: Python, Prefect, OpenAI API, ElevenLabs, Google Imagen, FFmpeg, S3 (boto3), Pydantic v2
- Main themes: orchestration, provider cost control, resilience around non-deterministic providers
- Case study: https://wyddy.tech/case-video-pipeline.html

## Browd - Browser AI agent (applied R&D at hao.vc, open source)

- Outcomes: live on the Chrome Web Store; 218 tests, 6 failure classes, 52–89% measured prompt-cache hit rate
- Technologies: TypeScript, LangGraph.js plan-and-execute, Chrome MV3, React
- Main themes: human approval before risky actions, isolated tab, typed failure handling
- Case study: https://wyddy.tech/case-browd.html

## NetWho - Contact RAG in Telegram (applied R&D at hao.vc, open source)

- Outcomes: live Telegram assistant over personal and organizational networks
- Technologies: pgvector embeddings plus keyword match, Supabase RLS, aiogram, Pydantic v2, Docker
- Main themes: answers grounded in source records, isolation per tenant
- Case study: https://wyddy.tech/case-netwho.html

## Digest - Personalized AI digest

- Outcomes: live, running daily
- Technologies: deterministic pipeline plus a stateful chat agent (DeepAgents, LangGraph, Supabase checkpointer), OpenRouter, python-telegram-bot
- Main themes: bounded pipelines vs model-driven agent loops, compacted memory
- Case study: https://wyddy.tech/case-digest.html
