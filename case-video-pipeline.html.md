# Video generation pipeline, rebuilt for throughput & cost

> Case Study · at Hao

- **Canonical:** https://wyddy.tech/case-video-pipeline.html
- **Role:** Lead on the pipeline
- **Scope:** Dialogue · TTS · images · compose · cost tracking
- **Status:** Live in production

Full video generation at Hao — topic to published mp4. Dialogue, TTS, images,
FFmpeg compose, S3 upload, composed as a two-stage JSON API, parallelized across
every I/O-bound call, deduplicated end-to-end.

## 01 · Context

Hao builds AI-autonomous orchestrators. One of them needed a pipeline that turns a
topic into a finished vertical video — scripted dialogue, voiced lines, generated
images, composed with sprites and karaoke subtitles, uploaded to storage. Every
generated unit costs real money across LLM calls, TTS, images, and storage, so
latency and cost were the whole point of the rebuild.

When I joined the project, the pipeline was linear — a single-path
orchestrator with no batch mode or cost instrumentation, operator-driven between
stages. **Each generation took minutes and cost roughly $2.** That's the starting
line.

## 02 · Architecture

I redesigned the pipeline as a **two-stage CLI API** that talks to itself via JSON
on stdin/stdout. Stage one generates the dialogue through a provider-agnostic LLM
call, reading per-character profiles with voices, sprites and catchphrases. Stage
two consumes that JSON and runs TTS and image generation in parallel, composes the
final video with FFmpeg, and uploads to S3. The two commands join with a pipe,
with no manual step in between.

Flow:
`topic → (Stage 1) LLM dialogue ← characters YAML → JSON contract (optional human review) → (Stage 2) {TTS · ElevenLabs, images · pluggable} → FFmpeg (ASS · sprites) → S3`.

## 03 · What changed

- **Parallelized generation (throughput):** Broke the sequential flow into
  independent units and ran LLM + TTS + image generation concurrently. Framed the
  bottleneck as I/O-bound network waits, not CPU, and moved everything to async tasks
  with tenacity-backed retries.
- **LLM request deduplication (cost):** Added a caller-level dedup layer keyed on
  prompt + model + params, so identical requests share a single response — same for
  image prompts with stable seeds.
- **Two-stage CLI with JSON contract (composability):** Split `dialogue_api` and
  `video_from_dialogue_api` into independent CLI commands that communicate via JSON
  on stdin/stdout. Either stage can be rerun, cached, or orchestrated externally.
- **Character profile system (reuse):** Each character is a YAML profile —
  ElevenLabs voice id, PNG sprite variants (telling, hearing), catchphrases. Adding
  a new character is a file drop, not a code change. FFmpeg overlays sprites
  per-line; ASS subtitles render karaoke sync per character.
- **Automated script workflow (manual work):** Replaced operator-driven steps with
  automated prompt workflows. Placeholder fallback images cover failed generations
  so the pipeline never blocks on one flaky API.

## 04 · Results

- **6× faster per-unit processing** — 60 min → 10 min per generation
- **−60% generation cost after dedup** — ≈$2 → ≈$0.80 per generation
- **½× manual script work** — automated prompt workflows

**Takeaway:** The cost and throughput wins came from treating every API call — LLM,
TTS, image — as one I/O-bound problem to parallelize and dedup. The two-stage JSON
contract was the unlock: either stage can be re-run, cached, or replayed without
touching the other.

## 05 · Stack

- **Orchestration:** SceneOrchestrator · two-stage CLI · JSON stdin/stdout · pydantic-settings · structlog · tenacity retries
- **Dialogue:** LLM dialogue · structured outputs · per-character profiles
- **Voice:** ElevenLabs TTS · pydub loudness norm
- **Images:** pluggable image providers · provider-agnostic adapter · placeholder fallback
- **Video:** FFmpeg · ASS karaoke subtitles · sprite overlays · background loop trimming
- **Storage:** Backblaze S3 · boto3
- **Infra:** Python 3.13 · uv · SOCKS5 proxy

---

Related case study: [NetWho — AI CRM for a personal network](https://wyddy.tech/case-netwho.html)

Want the same kind of rewrite on your pipeline? Get in touch: https://t.me/wyddy7
