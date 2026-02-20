# ADR-001: Split AI Architecture — Hono Microservice on Render

**Date:** 2026-02-20
**Status:** Accepted
**Deciders:** Faheem Syed

---

## Context

CollabBoard originally planned to run the AI agent inside the Cloudflare Worker (the "monolith" approach). Before any AI code was implemented, we evaluated whether that plan was viable.

### Constraints that forced a re-evaluation

| Constraint | Impact on CF Worker AI |
|---|---|
| 128MB Worker memory limit | LangChain + LangSmith SDK alone exceed this during agent execution |
| No Docker runtime on Workers | Cannot containerise the agent for reproducible builds or Render-style deploys |
| CPU-time billing (not wall time) | A 30s LLM call consumes real wall time on the Edge; Cloudflare still bills CPU ms — and a stalled Worker can starve other requests |
| No persistent processes | Agents that loop across tool calls need a stable process; Workers terminate after the request completes |
| npm package ecosystem gaps | Some LangChain integrations (LangSmith SDK, certain loaders) require Node.js APIs unavailable in the Workers runtime |

**Conclusion:** Running a LangChain agent in a Cloudflare Worker causes edge bloat, is not Dockerizable, and risks destabilizing the real-time WebSocket path.

---

## Decision

Extract all AI/LLM logic into a dedicated **Hono microservice** running in a Docker container on **Render**.

The Cloudflare Worker becomes a pure **lean edge proxy**: it verifies the Clerk JWT, sanitises the request, and forwards it to the Hono service over an internally-authenticated HTTP call. The Worker never imports LangChain, LangSmith, or any model SDK.

---

## Framework Choice: Hono (not Express, not Fastify)

Three reasons:

1. **Shared mental model with Cloudflare Workers.** Hono uses the same Web Standard `Request`/`Response` API that Workers use natively. A developer working on both services operates in the same conceptual space. Express uses its own `req`/`res` abstraction; Fastify has its own plugin model — both create unnecessary context-switching.

2. **`@hono/zod-validator` parity.** Our CF Worker already validates incoming payloads with Zod. Hono's first-party validator middleware (`@hono/zod-validator`) provides an identical validation pattern at the Hono layer. We can reuse the Zod schemas from `shared/` in both services with zero adaptation.

3. **Lightweight and fast.** Hono has near-zero overhead compared to Express/Fastify and starts in milliseconds inside the Docker container.

---

## AI Stack Choice: LangChain + OpenRouter + LangSmith

### Why LangChain?

- Provides `DynamicStructuredTool` with Zod schema validation — maps directly to our `shared/` shape schemas.
- `AgentExecutor` (or `withStructuredOutput`) gives us reliable structured JSON output without hand-rolling a parsing layer.
- Model-agnostic: swap providers by changing `modelName` — no business logic changes.

### Why OpenRouter (not Anthropic SDK direct)?

| Factor | Anthropic Direct | OpenRouter |
|---|---|---|
| Model choice | Claude only | 200+ models (Llama, Gemini, Mistral, etc.) |
| API compatibility | Proprietary SDK | OpenAI-compatible — works with LangChain's `ChatOpenAI` class, just override `baseURL` |
| Cost flexibility | Fixed Claude pricing | Can route to free-tier models (`meta-llama/llama-3-8b-instruct:free`) for dev/test |
| Key management | `ANTHROPIC_API_KEY` | Single `OPENROUTER_API_KEY` for all models |

OpenRouter is wired by instantiating LangChain's `ChatOpenAI` with `baseURL: "https://openrouter.ai/api/v1"` and the `OPENROUTER_API_KEY`. No custom provider code needed.

**Default model:** `google/gemini-2.0-flash-exp:free` (free tier, fast, reliable tool calling and structured output). Can be overridden to any OpenRouter model slug via `OPENROUTER_MODEL` env var.

### Why LangSmith?

- Zero-code tracing: set `LANGSMITH_TRACING=true` and every chain, tool call, prompt, and model response is automatically captured.
- Essential for debugging agent tool-calling behaviour (seeing exactly what the model returned before Zod validation, which tools were called and in what order, token counts).
- Free tier covers our usage.

---

## Security Model

```
Browser
  │  Clerk JWT (Authorization: Bearer ...)
  ▼
Cloudflare Worker
  │  verifies JWT with @clerk/backend
  │  X-Internal-Secret: <shared-secret>
  ▼
Hono AI Service (Render, private network or HTTPS)
  │  OPENROUTER_API_KEY
  ▼
OpenRouter → LLM
```

- The Hono service URL (`AI_SERVICE_URL`) is stored as a Wrangler secret — it is never sent to the browser.
- The Hono service validates `X-Internal-Secret` on every request. Requests without it return `401`.
- The frontend never calls the AI service directly.

---

## Consequences

**Positive:**
- CF Worker memory footprint stays under 1MB — well within the 128MB limit.
- AI failures cannot take down the real-time WebSocket path.
- Ability to Dockerize and version the AI service independently.
- Full LangSmith trace visibility for every generation request.
- Model flexibility: switch from free Llama to Gemini Flash in one env var change.

**Negative / Trade-offs:**
- Additional network hop: Worker → Hono service adds ~50–100ms latency (acceptable given AI generation already takes 1–3s).
- Two services to deploy and monitor instead of one.
- Render free tier sleeps after 15min of inactivity (cold start ~500ms). Acceptable for a demo/MVP; upgrade to Render Starter ($7/mo) to eliminate.

---

## Rejected Alternatives

| Alternative | Reason Rejected |
|---|---|
| AI in CF Worker | Edge bloat, no Docker, 128MB memory cap, Worker termination after request |
| Vercel serverless function | 10s wall-time timeout kills long LLM calls |
| Express on Render | Diverges from Web Standard Request/Response; `@hono/zod-validator` parity lost |
| Fastify on Render | Same divergence issue as Express; heavier plugin model |
| LiteLLM proxy | Adds another service and a network hop with no additional benefit over direct OpenRouter |
