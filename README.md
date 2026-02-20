# CollabBoard: AI-First Multiplayer Whiteboard

A high-performance, real-time collaborative whiteboard with AI-powered layout generation via a dedicated microservice.

## Architecture (Split AI)

| Concern | Technology | Host |
|---------|-----------|------|
| Frontend SPA | React + Vite + tldraw + Clerk | Cloudflare Pages |
| Auth / WebSockets / REST | Cloudflare Workers + Durable Objects + D1 | Cloudflare Edge |
| AI Agent | Hono + LangChain + OpenRouter | Render (Docker) |
| Shared Contracts | Zod schemas (`shared/`) | n/a |

The Cloudflare Worker stays lean: it handles WebSocket multiplayer sync, Clerk JWT verification, and board metadata via D1. It does **not** contain any LLM logic. When a user requests AI generation, the Worker verifies the JWT and forwards the sanitised payload to the Hono AI microservice over an internal authenticated HTTP call.

The Hono AI service runs in a Docker container on Render. It uses LangChain with OpenRouter as the model provider (model-agnostic, swap models without code changes) and LangSmith for full chain observability.

## Project Structure

```
CollabBoard/
├── frontend/          # React SPA (Vite + tldraw + Clerk)
│   ├── src/
│   └── package.json
│
├── backend/           # Cloudflare Worker (WebSockets, Auth, D1 REST)
│   ├── src/
│   │   ├── index.ts
│   │   ├── auth.ts
│   │   ├── db.ts
│   │   └── durable-objects/BoardRoom.ts
│   ├── wrangler.toml
│   └── package.json
│
├── ai-service/        # Dockerized Hono AI microservice (Render)
│   ├── src/
│   │   ├── index.ts   # Hono app entry + POST /generate
│   │   └── agent.ts   # LangChain agent + tool definitions (Zod-typed)
│   ├── Dockerfile
│   └── package.json
│
├── shared/            # Shared Zod schemas (shapes, API contracts)
│   ├── src/
│   │   ├── shapes.ts
│   │   ├── api.ts
│   │   └── index.ts
│   └── package.json
│
└── docs/
    └── decisions/
        └── 001-split-ai-architecture.md
```

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9
- Docker (for running `ai-service` locally)
- Cloudflare account (free tier)
- Clerk account (free tier)
- OpenRouter account (free tier available)
- LangSmith account (optional, for tracing)

### Installation

```bash
# Install all workspace dependencies
npm install

# Build the shared package first
npm run build:shared
```

### Development

#### 1. Configure Environment Variables

**Frontend (`frontend/.env`):**
```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=http://localhost:8787
```

**Backend (`backend/.dev.vars`):**
```bash
CLERK_SECRET_KEY=sk_test_...
AI_SERVICE_URL=http://localhost:3001
AI_SERVICE_SECRET=dev-internal-secret
```

**AI Service (`ai-service/.env`):**
```bash
OPENROUTER_API_KEY=sk-or-...
LANGSMITH_API_KEY=ls__...
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=collabboard
INTERNAL_SECRET=dev-internal-secret
PORT=3001
```

#### 2. Start Development Servers

```bash
# Terminal 1: Cloudflare Worker
npm run dev:backend

# Terminal 2: AI microservice (direct Node.js, no Docker needed locally)
npm run dev:ai

# Terminal 3: Frontend
npm run dev:frontend
```

### Deployment

#### Frontend (Cloudflare Pages)
```bash
npm run deploy:frontend
```

#### Backend (Cloudflare Worker)
```bash
cd backend
wrangler secret put CLERK_SECRET_KEY
wrangler secret put AI_SERVICE_URL
wrangler secret put AI_SERVICE_SECRET
npm run deploy:backend
```

#### AI Service (Render via Docker)
Push to your Render-connected repository. Render will build the Dockerfile in `ai-service/` automatically. Set environment variables in the Render dashboard.

## Tech Stack

| Layer | Technology | Why? |
|-------|-----------|------|
| Frontend Framework | React + Vite | Fast builds, hot reload |
| Canvas Library | tldraw SDK | High-performance infinite canvas |
| Authentication | Clerk | Drop-in React components, JWT verification |
| Frontend Hosting | Cloudflare Pages | Free CDN, global edge |
| Worker Runtime | Cloudflare Workers | 0ms cold starts, WebSocket support |
| Real-time Sync | Cloudflare Durable Objects | Zero-latency embedded SQLite, free tier |
| AI HTTP Framework | Hono + @hono/node-server | Web-standard Request/Response, shares patterns with CF Worker |
| AI Orchestration | LangChain.js | Model-agnostic tool execution, agent executor |
| LLM Provider | OpenRouter | Model flexibility (Gemini, Llama, Mistral, etc.), single API key |
| Observability | LangSmith | Full chain/tool tracing for AI debugging |
| Type Safety | TypeScript + Zod | Strict validation at every service boundary |

## Strict Architectural Rules

1. **CF WORKER STAYS LEAN** — no LLM logic in the Worker. It proxies to the Hono service.
2. **AI IN HONO SERVICE ONLY** — all LangChain/OpenRouter code lives in `ai-service/`. No Express. No Fastify.
3. **NO FIREBASE DATABASE** — Firebase is for hosting only. Data lives in Durable Objects + D1.
4. **ZOD FOR EVERYTHING** — validate all AI outputs at the Hono layer with `@hono/zod-validator`.
5. **INTERNAL SECRET** — the Hono service is never called directly by browsers. The Worker authenticates via `X-Internal-Secret`.

## Resources

- [tldraw Documentation](https://tldraw.dev)
- [Hono Documentation](https://hono.dev)
- [LangChain.js Documentation](https://js.langchain.com)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [LangSmith Documentation](https://docs.smith.langchain.com)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Clerk React SDK](https://clerk.com/docs/quickstarts/react)

## License

MIT
