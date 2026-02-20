CollabBoard: Architecture & Decision Log
=========================================

## High-Level Architecture

CollabBoard uses a **Split AI Architecture**:

- **Cloudflare Edge Layer** — Workers handle WebSocket multiplayer sync (via Durable Objects), Clerk JWT auth, D1 REST endpoints, and proxying AI requests. Stays lean; no LLM logic.
- **AI Microservice** — A Dockerized Hono service on Render runs the LangChain agent, calls OpenRouter for model inference, and emits LangSmith traces. Isolated from the edge layer for scalability and observability.
- **Frontend** — React SPA on Cloudflare Pages using tldraw SDK and Clerk Auth.
- **Shared Contracts** — Zod schemas in `shared/` are consumed by the Worker, the Hono service, and the frontend. Single source of truth.

---

## Architecture Decision Log

### 1. Frontend Framework & Canvas Rendering

- **Dilemma:** Standard React DOM rendering is too slow for 500+ moving whiteboard objects.
- **Options:** Pure React (too slow), Excalidraw (less customisable for AI), tldraw.
- **Decision:** React + tldraw SDK.
- **Rationale:** tldraw uses a custom signals store and CSS transforms, bypassing DOM bottlenecks. Its shape model maps directly to our Zod schemas, making AI-generated layouts trivial to apply.

---

### 2. Real-Time Sync & Database Layer

- **Dilemma:** Building real-time conflict resolution from scratch is expensive. Managed services (Liveblocks) are cost-cliffed at scale.
- **Options:** Firebase Realtime DB, Supabase, Convex, Cloudflare Durable Objects.
- **Decision:** Cloudflare Durable Objects (SQLite backend).
- **Rationale:** Each board room gets a dedicated mini-server at the edge. The embedded SQLite database runs in the same thread as the WebSocket connection — effectively zero-latency reads/writes. Free tier covers our load. tldraw's creators maintain a sync template explicitly built for this architecture.

---

### 3. Backend: Cloudflare Worker (Lean Edge Layer)

- **Responsibility:** WebSocket routing to Durable Objects, Clerk JWT verification, D1 CRUD for board metadata and ACL (boards + board_guests), internal proxy to the AI service.
- **What it does NOT do:** No LangChain, no OpenRouter calls, no AI logic of any kind.
- **Rationale:** Keeping the Worker lean prevents edge bloat. Cloudflare Workers have a 128MB memory limit and are not designed for long-running stateful agent loops. Isolating AI into its own service means the Worker can't be taken down by a runaway LLM call.

---

### 4. AI Agent: Dockerized Hono Microservice on Render

- **Dilemma:** We need a secure, containerisable environment for LangChain agents that can hold persistent HTTP connections (30s+), support npm packages unavailable on the edge, and be independently scalable.
- **Options considered:**
  - Keep AI in CF Worker — rejected: 128MB memory cap, no Docker, no LangSmith SDK support.
  - Vercel serverless — rejected: 10s wall-time timeout, cold starts.
  - Express/Fastify on Render — rejected: heavier framework, diverges from Web Standard Request/Response pattern used by CF Worker.
- **Decision:** Hono + @hono/node-server in a Docker container on Render.
- **Rationale:**
  1. **Edge bloat prevention** — The agent executor, LangSmith SDK, and LangChain tooling are heavy npm packages. They don't belong on the 1ms cold-start edge.
  2. **Dockerization** — Render runs the container, giving us persistent processes, controlled memory, and reproducible builds. CF Workers cannot be Dockerized.
  3. **Hono** — Shares the same Web Standard `Request`/`Response` API as Cloudflare Workers. We can reuse `@hono/zod-validator` for the same validation pattern we'd use on the Worker. Zero conceptual overhead switching between the two.
  4. **No lock-in** — The service is a plain Docker image; it can move to Fly.io, Railway, or any OCI-compatible host.

---

### 5. AI Stack: LangChain + OpenRouter + LangSmith

- **Dilemma:** We need model flexibility (ability to swap LLMs) and full observability into agent execution without vendor lock-in.
- **Options:**
  - Anthropic SDK direct — single vendor, no model choice, no built-in tracing.
  - OpenAI SDK direct — locked to OpenAI.
  - LangChain + LiteLLM — LiteLLM adds another network hop.
  - LangChain + OpenRouter — single API key, 200+ models, built-in LangSmith tracing via `LANGCHAIN_*` env vars.
- **Decision:** LangChain.js + OpenRouter (via OpenAI-compatible base URL) + LangSmith.
- **Rationale:**
  1. **Model flexibility** — Switch from `google/gemini-2.0-flash-exp:free` to `google/gemini-flash-1.5` or any other OpenRouter model by changing one env var. No code changes.
  2. **LangSmith observability** — Set `LANGSMITH_TRACING=true` and every chain, tool call, and LLM invocation is traced automatically. Essential for debugging agent tool-calling behaviour.
  3. **Structured output / tool calling** — LangChain's `withStructuredOutput` and `DynamicStructuredTool` give us Zod-typed tool schemas that map directly to our `shared/` types.

---

### 6. Hosting & Domains

- **Frontend:** Cloudflare Pages (`.pages.dev`) — free SSL, Git CI/CD, global CDN.
- **Worker:** Cloudflare Workers (`.workers.dev`) — free tier, 0ms cold starts.
- **AI Service:** Render free/starter tier — Docker container, persistent process, no cold-start penalty for 30s+ AI calls.
- **Rationale:** Unified frontend+backend on Cloudflare for optimal colocated latency. Render for the AI service because it's the only provider in the zero-cost tier that supports persistent Docker containers without a 10s timeout.

---

### 7. Security Model

- Browser → CF Worker: Clerk JWT in `Authorization: Bearer` header. Worker verifies with `@clerk/backend` before any operation.
- CF Worker → Hono AI Service: `X-Internal-Secret` header (a shared secret set as a Wrangler secret + Render env var). The Hono service rejects any request missing this header. The AI service URL is never exposed to the browser.
- Hono AI Service → OpenRouter: `OPENROUTER_API_KEY` environment variable. Never touches the browser.

---

### 8. Development Tooling

- **Monorepo:** npm workspaces. `shared/` schemas are referenced by all three services.
- **IDE:** VS Code + Claude Code CLI.
- **Type Safety:** TypeScript strict mode + Zod across all packages.
- **Testing:** Vitest with per-folder environments (node for unit tests, happy-dom for tldraw Editor integration tests).
