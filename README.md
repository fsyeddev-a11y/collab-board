# CollabBoard: AI-First Multiplayer Whiteboard

A real-time collaborative whiteboard where teams brainstorm visually and an AI agent manipulates the canvas through natural language. Draw a wireframe, hit "Generate Code," and get a live React + Tailwind preview.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          BROWSER                                │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              React SPA (Vite + tldraw + Clerk)            │  │
│  │                                                           │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ BoardPage  │  │ AI Chat      │  │ Code Preview     │  │  │
│  │  │ (tldraw    │  │ Panel        │  │ Panel (iframe    │  │  │
│  │  │  canvas)   │  │              │  │  React+Tailwind) │  │  │
│  │  └─────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │  │
│  │        │                │                    │            │  │
│  │  ┌─────┴──────┐  ┌─────┴────────┐  ┌───────┴──────────┐ │  │
│  │  │ WebSocket  │  │ boardState   │  │ spatialAnalyzer  │ │  │
│  │  │ Sync       │  │ Builder      │  │ (geometric tree) │ │  │
│  │  └─────┬──────┘  └─────┬────────┘  └───────┬──────────┘ │  │
│  └────────┼───────────────┼────────────────────┼────────────┘  │
└───────────┼───────────────┼────────────────────┼───────────────┘
            │               │                    │
       Clerk JWT       Clerk JWT            Clerk JWT
            │               │                    │
            ▼               ▼                    ▼
┌───────────────────────────────────────────────────────────────┐
│                  CLOUDFLARE EDGE                              │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              CF Worker (src/index.ts)                    │  │
│  │                                                         │  │
│  │  ┌──────────┐  ┌────────────┐  ┌─────────────────────┐ │  │
│  │  │ JWT Auth │  │ REST       │  │ AI Proxy            │ │  │
│  │  │ (Clerk)  │  │ Routes     │  │ POST /api/generate  │ │  │
│  │  │          │  │ (CRUD)     │  │ POST /api/gen-code  │ │  │
│  │  └──────────┘  └─────┬──────┘  └──────────┬──────────┘ │  │
│  │                      │                     │            │  │
│  │                      ▼                     │            │  │
│  │              ┌──────────────┐              │            │  │
│  │              │ D1 Database  │              │            │  │
│  │              │ (board meta, │              │            │  │
│  │              │  guest ACL)  │              │            │  │
│  │              └──────────────┘              │            │  │
│  └────────────────────────────────────────────┼────────────┘  │
│                                               │               │
│  ┌──────────────────────────────────┐         │               │
│  │ Durable Object: BoardRoom       │         │               │
│  │ (one instance per board)        │         │               │
│  │                                  │         │               │
│  │  ┌───────────┐ ┌─────────────┐  │         │               │
│  │  │ WebSocket │ │ Embedded    │  │         │               │
│  │  │ Hub       │ │ SQLite      │  │         │               │
│  │  │ (cursors, │ │ (canvas     │  │         │               │
│  │  │  deltas)  │ │  state)     │  │         │               │
│  │  └───────────┘ └─────────────┘  │         │               │
│  └──────────────────────────────────┘         │               │
└───────────────────────────────────────────────┼───────────────┘
                                                │
                                  HTTPS + X-Internal-Secret
                                                │
                                                ▼
┌───────────────────────────────────────────────────────────────┐
│                  RENDER (Docker)                               │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │          Hono AI Microservice (Node 22 Alpine)          │  │
│  │                                                         │  │
│  │  ┌─────────────────────┐  ┌──────────────────────────┐ │  │
│  │  │ POST /generate      │  │ POST /generate-code      │ │  │
│  │  │                     │  │                          │ │  │
│  │  │ LangChain Agent     │  │ Direct LLM invoke       │ │  │
│  │  │ ┌─────────────────┐ │  │ (temp=0, deterministic) │ │  │
│  │  │ │ 5 Tools:        │ │  │                          │ │  │
│  │  │ │ createElements  │ │  │ SpatialNode[] →          │ │  │
│  │  │ │ updateElements  │ │  │ React+Tailwind JSX      │ │  │
│  │  │ │ layoutElements  │ │  │                          │ │  │
│  │  │ │ createDiagram   │ │  └──────────────────────────┘ │  │
│  │  │ │ navigateTo      │ │                               │  │
│  │  │ └─────────────────┘ │  ┌──────────────────────────┐ │  │
│  │  └─────────┬───────────┘  │ LangSmith (auto-trace)   │ │  │
│  │            │              └──────────────────────────┘ │  │
│  │            ▼                                           │  │
│  │  ┌─────────────────────┐                               │  │
│  │  │ OpenRouter API      │                               │  │
│  │  │ (GPT-4o-mini)       │                               │  │
│  │  └─────────────────────┘                               │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### AI Agent: Natural Language → Canvas

```
User: "Create a SWOT analysis"
  │
  ├─ Frontend: buildTieredBoardState()
  │    └─ Viewport shapes → full props (trimmed)
  │    └─ Off-screen shapes → id + type + text only (~70% token savings)
  │
  ├─ CF Worker: verify JWT → check D1 access → add X-Internal-Secret
  │
  ├─ Hono: AgentExecutor (max 4 iterations)
  │    └─ LLM picks createDiagram tool
  │    └─ Returns { toolCalls, usage }
  │
  └─ Frontend: aiResolver.ts
       └─ editor.batch() → create frames + stickies
       └─ zoomToFit() → animate camera to created shapes
```

### Spatial Compiler: Wireframe → React Code

```
User selects wireframe shapes → clicks "Generate Code"
  │
  ├─ spatialAnalyzer.ts
  │    └─ Geometric containment (AABB, not tldraw parentId)
  │    └─ Detect layout: row / col / grid
  │    └─ Classify: button vs input (from label keywords)
  │    └─ Compute alignSelf: start / center / end
  │    └─ Output: SpatialNode[] (nested semantic tree)
  │
  ├─ Hono: codeGenerator.ts (temp=0, deterministic)
  │    └─ Strict compiler rules: frame→<nav>, geo→<button>, etc.
  │    └─ Output: React + Tailwind JSX
  │
  └─ CodePreviewPanel (floating, draggable)
       └─ Preview tab: iframe with React UMD + Tailwind CDN
       └─ Code tab: copy to clipboard
```

### Real-Time Sync

```
User A moves a shape
  │
  ├─ tldraw onChange → WebSocket.send(binary diff)
  │
  ├─ Durable Object (BoardRoom)
  │    └─ Write to embedded SQLite
  │    └─ Broadcast to all other WebSocket connections
  │
  └─ User B's browser
       └─ mergeRemoteChanges() → canvas updates instantly
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + Vite + tldraw 2.x | High-performance infinite canvas |
| Auth | Clerk (React SDK + JWT) | Drop-in components, JWT verification |
| Edge API | Cloudflare Workers | 0ms cold starts, WebSocket support |
| Real-time Sync | Durable Objects + SQLite | Zero-latency, free tier, tldraw sync template |
| Metadata DB | Cloudflare D1 | Serverless SQL for board ownership/ACL |
| AI Framework | Hono + @hono/node-server | Web-standard, shares patterns with CF Worker |
| AI Orchestration | LangChain.js | Tool-calling agent with structured outputs |
| LLM Provider | OpenRouter (GPT-4o-mini) | Model-agnostic, swap via env var |
| Observability | LangSmith | Full chain/tool tracing |
| Type Safety | TypeScript + Zod | Strict validation at every service boundary |
| Deployment | CF Pages, CF Workers, Render | Edge + Docker |

---

## Project Structure

```
CollabBoard/
├── frontend/           # React SPA (Vite + tldraw + Clerk)
│   ├── src/
│   │   ├── pages/      # BoardPage.tsx, DashboardPage.tsx
│   │   ├── components/ # CodePreviewPanel, custom toolbar
│   │   └── utils/      # aiResolver, boardStateBuilder, spatialAnalyzer
│   └── package.json
│
├── backend/            # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts    # Request routing + AI proxy
│   │   ├── auth.ts     # Clerk JWT verification
│   │   ├── db.ts       # D1 queries (parameterized)
│   │   └── durable-objects/BoardRoom.ts
│   ├── migrations/     # D1 SQL migrations
│   └── wrangler.toml
│
├── ai-service/         # Dockerized Hono microservice (Render)
│   ├── src/
│   │   ├── index.ts    # Hono routes (/generate, /generate-code)
│   │   ├── agent.ts    # LangChain agent + 5 tools
│   │   └── codeGenerator.ts  # Spatial compiler
│   └── Dockerfile
│
├── shared/             # Zod schemas (npm workspace)
│   └── src/
│       ├── api.ts      # Service boundary contracts
│       └── shapes.ts   # tldraw shape schemas
│
└── docs/
    ├── claude-pm/      # PM specs and SE implementation prompts
    └── ListOfPrompts/  # Archived agent prompts
```

---

## Setup Guide

### Prerequisites

- Node.js >= 18
- Wrangler CLI (`npm i -g wrangler`)
- Accounts: Cloudflare, Clerk, OpenRouter
- Optional: LangSmith (for AI tracing)

### 1. Install & Build Shared

```bash
npm install
npm run build:shared
```

### 2. Configure Environment

**Frontend** (`frontend/.env`):
```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_BACKEND_WS_URL=ws://localhost:8787
```

**Backend** (`backend/.dev.vars`):
```bash
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
AI_SERVICE_URL=http://localhost:3001
AI_SERVICE_SECRET=dev-secret
```

**AI Service** (`ai-service/.env`):
```bash
OPENROUTER_API_KEY=sk-or-...
INTERNAL_SECRET=dev-secret
PORT=3001
# Optional
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=ls__...
LANGCHAIN_PROJECT=collabboard
```

### 3. Start Dev Servers (3 terminals)

```bash
# Terminal 1: Backend
npm run dev:backend          # → localhost:8787

# Terminal 2: AI Service
npm run dev:ai               # → localhost:3001

# Terminal 3: Frontend
npm run dev:frontend          # → localhost:5173
```

### 4. Deploy

```bash
# Backend → Cloudflare Workers
cd backend
wrangler secret put CLERK_SECRET_KEY
wrangler secret put AI_SERVICE_SECRET
npm run deploy

# Frontend → Cloudflare Pages
cd frontend
npm run deploy

# AI Service → Render (push to GitHub, auto-builds Dockerfile)
# Set env vars in Render dashboard
# Build context: repo root | Dockerfile path: ai-service/Dockerfile
```

---

## Architectural Rules

1. **CF Worker stays lean** — no LLM logic. Proxies to Hono service.
2. **AI in Hono service only** — all LangChain/OpenRouter code in `ai-service/`.
3. **No Firebase database** — data lives in Durable Objects + D1.
4. **Zod for everything** — validate AI outputs with `@hono/zod-validator`.
5. **Internal secret** — browser never calls AI service directly. Worker authenticates via `X-Internal-Secret`.

---

## License

MIT
