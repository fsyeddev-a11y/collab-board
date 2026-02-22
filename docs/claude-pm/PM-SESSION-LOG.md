<!-- CLAUDE-PM PLANNING DOCUMENT — Do not modify. This file is maintained by the Claude-PM project management agent. -->

# CollabBoard — Claude-PM Session Log

## Tech Stack

| Layer | Technology | Version | Host |
|-------|-----------|---------|------|
| Frontend SPA | React 18 + Vite + tldraw 2.x | react 18.2, tldraw ^2.0.0 | Cloudflare Pages |
| Authentication | Clerk (React SDK ^5.60.2, Backend ^1.34.0) | v2 JWT format | Clerk Cloud |
| Edge API / WS | Cloudflare Workers + Durable Objects + D1 | wrangler ^4.0.0 | Cloudflare Edge |
| AI Microservice | Hono 4.6.17 + @hono/node-server | Node.js | Render (Docker) |
| AI Orchestration | LangChain.js 0.3.11 + @langchain/openai 0.3.16 | createToolCallingAgent | Render |
| LLM Provider | OpenRouter (ChatOpenAI w/ baseURL override) | default: openai/gpt-4o-mini | OpenRouter API |
| Observability | LangSmith 0.5.4 | auto-trace via env vars | LangSmith Cloud |
| Type Safety | TypeScript 5.x + Zod 3.22-3.24 | strict mode | All packages |
| Monorepo | npm workspaces (4 packages) | — | — |

## Project Structure Summary

```
CollabBoard/
├── frontend/           # React SPA (Vite + tldraw + Clerk)
│   ├── src/pages/BoardPage.tsx      — Main canvas page, AI panel, WebSocket sync
│   ├── src/pages/DashboardPage.tsx  — Board list, creation, sharing
│   ├── src/utils/aiResolver.ts      — Executes AI tool calls on tldraw Editor
│   ├── src/utils/frameActions.ts    — Frame delete/ungroup utilities
│   └── src/utils/noteArrowOverride.ts — Patch note clone handle → arrow
│
├── backend/            # Cloudflare Worker
│   ├── src/index.ts                 — REST routes, WS upgrade, AI proxy
│   ├── src/auth.ts                  — Clerk JWT verification (v1+v2)
│   ├── src/db.ts                    — D1 queries (boards, guests)
│   └── src/durable-objects/BoardRoom.ts — DO: SQLite sync + WebSocket broadcast
│
├── ai-service/         # Dockerized Hono AI microservice
│   ├── src/index.ts                 — Hono routes (/health, /warmup, /generate)
│   ├── src/agent.ts                 — LangChain agent, 4 tools, system prompt
│   └── Dockerfile                   — Multi-stage build w/ workspace support
│
├── shared/             # Zod schemas (consumed by all packages)
│   ├── src/shapes.ts                — tldraw shape schemas (note, geo, text, frame, arrow)
│   ├── src/api.ts                   — AI request/response, WS message, tool call schemas
│   └── src/index.ts                 — Re-exports
│
└── docs/
    ├── decisions/001-split-ai-architecture.md
    └── claude-pm/                   — This directory (PM planning artifacts)
```

## Current AI Agent Architecture

### Tool Definitions (4 tools in ai-service/src/agent.ts)

| Tool | Purpose | Key Schema Fields |
|------|---------|-------------------|
| createElements | Ad-hoc shapes (1-30) | type, color?, text? |
| updateElements | Batch-edit by ID | shapeId, newText?, newColor?, resizeInstruction?, moveInstruction?, newName? |
| layoutElements | Arrange existing shapes | shapeIds (min 2), layoutType (grid/row/column/even-spacing) |
| createDiagram | Structured layouts | diagramType (swot/kanban/user_journey/retrospective/custom_frame), title, sections[] |

### System Prompt Key Directives
- Agent NEVER computes x/y coordinates — outputs semantic intent only
- Agent must reference exact shape IDs from board state (no hallucination)
- Parallel tool calls preferred for single-response completion
- Batch updates into single updateElements call
- Max 4 agent iterations (maxIterations: 4)

### Data Flow: AI Generation
1. Frontend gathers ALL page shapes (id, type, x, y, parentId, isSelected, props)
2. POST /api/generate with prompt + boardId + boardState
3. CF Worker verifies JWT, proxies to Hono with X-Internal-Secret
4. Hono agent runs LangChain executor (up to 4 iterations)
5. Returns { toolCalls: ToolCall[], modelUsed?: string }
6. Frontend aiResolver.ts executes tool calls on tldraw Editor
7. Changes sync to other users via WebSocket

### Frontend AI Resolver (frontend/src/utils/aiResolver.ts)
- createElements: Places in horizontal row starting below existing shapes
- updateElements: Semantic moves (150px increments), resize (double/half/fit), color/text changes
- layoutElements: Grid, row, column, even-spacing arrangements
- createDiagram: SWOT (2x2 grid), kanban/retro (horizontal columns), user_journey (stages + arrows)
- Post-batch: fitFramesToChildren() adjusts frame bounds after all ops

### What is NOT Sent to AI
- Viewport position/zoom (camera state) — NOT sent
- Other users' cursors — NOT sent
- Connection/presence data — NOT sent

## Architecture Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-20 | Split AI into Hono microservice on Render | CF Worker 128MB limit, no Docker, LangSmith SDK needs Node.js |
| 2026-02-20 | LangChain + OpenRouter + LangSmith | Model flexibility (200+ models), zero-code tracing, Zod tool schemas |
| 2026-02-20 | Hono (not Express/Fastify) | Web Standard Request/Response parity with CF Worker, @hono/zod-validator |
| Pre-2026-02-20 | tldraw SDK for canvas | Custom signals store, CSS transforms, shape model maps to Zod schemas |
| Pre-2026-02-20 | CF Durable Objects for sync | Zero-latency embedded SQLite, free tier, tldraw sync template |
| Pre-2026-02-20 | Migrated hosting from Firebase to Cloudflare Pages | Unified edge platform, single CLI (wrangler) |

## Claude-B Specs Produced

| Spec ID | Description | Priority | Status | Date |
|---------|-------------|----------|--------|------|
| CB-001 | Replace createElements + createDiagram with unified batchOperations tool (ref-IDs, layout directives) | P0 | Drafted | 2026-02-22 |

## Open Questions

1. **Viewport data**: The frontend currently does NOT send viewport/camera state to the AI agent. This is critical for P0-A (placing objects in view) and P0-C (viewport-scoped context). What camera/viewport API does tldraw expose? *(Deferred to next spec — CB-001 uses existing findStartPosition for now)*
2. **Object placement**: Currently objects land at `findStartPosition()` which finds empty space below existing shapes — not within the user's viewport. This is BUG-001. *(Deferred to viewport spec)*
3. **Chat panel lifecycle**: After AI response, `setAiPanelOpen(false)` is called explicitly — this is BUG-003. The panel closes and the prompt is cleared. *(Deferred to chat UI spec)*
4. ~~**Multi-step reliability**: Agent is limited to `maxIterations: 4`. Complex prompts may exhaust iterations.~~ **RESOLVED by CB-001**: batchOperations expresses entire structures in a single tool call, reducing iteration pressure.
5. ~~**Ref-ID system**: No cross-referencing between tool calls.~~ **RESOLVED by CB-001**: ref-IDs within batchOperations enable parent-child and connector binding.
6. **Board state token cost**: Currently ALL shapes are serialized and sent. For large boards this will exceed token limits. P0-C addresses this. *(Deferred to context optimization spec)*
7. ~~**createDiagram vs. composable tools**: Migration path unclear.~~ **RESOLVED**: Option B chosen — replace with batchOperations, preserve layout algorithms via layout directives.

## Session History

### Session 1 — 2026-02-22
**Topics Discussed**: Initial codebase review, Claude-PM activation, batch schema design for P0-B
**Decisions Made**:
1. **Option B (replace createDiagram entirely)** — createElements and createDiagram will be replaced by a single batchOperations tool. Rationale: eliminates tool selection ambiguity, one code path, preserves existing layout algorithms via layout directives.
2. **5 operation types** — createFrame, createNote, createShape, createText, createConnector. Covers all current creation scenarios.
3. **3 known template directives** — swot-2x2, columns, journey-stages. Map directly to existing layoutSwot, layoutColumns, layoutUserJourney functions. Additional templates handled by generic directives (grid, rows, flowchart-top-down, flowchart-left-right, freeform).
4. **Strict dependency ordering** — Resolver processes operations in array order. Invalid parentRef/fromRef/toRef causes graceful skip, not crash. No topological sort.
5. **50 operations max** — Configurable single constant. Sufficient for complex structures, safe for tldraw rendering performance.
6. **3-layer ref-ID safety** — System prompt guidance (naming conventions), Zod schema validation (non-empty, min 2 chars, alphanumeric+underscore), resolver-side dedup/skip with console warnings.
7. **System prompt recipes** — Known patterns (SWOT, kanban, journey, flowchart) documented as explicit recipes in the system prompt to nudge LLM toward consistent output.

**Action Items**:
- CB-001 spec drafted and saved to docs/claude-pm/PM-SPEC-CB-001.md
- Ready for developer review and handoff to Claude-B
- After CB-001 is implemented: proceed to viewport placement (P0-A/BUG-001), then chat UI (BUG-003/P1)

**Notes**:
- Codebase is well-structured with clear separation of concerns
- AI agent architecture is functional but has the 3 documented bugs
- The intent-based tool design (no coordinates from LLM) is sound — the issues are in frontend resolution and missing viewport awareness
- Test coverage exists for both agent tools (schema validation) and frontend resolver (aiResolver.test.ts with 50+ tests)
- Developer flagged ref-ID collision risk — addressed with 3-layer defense in CB-001
- The 50 operations limit is a Zod array max, not an agent iteration limit — clarified in session
