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

## Current AI Agent Architecture

### Tool Definitions (4 tools in ai-service/src/agent.ts)

| Tool | Purpose | Key Schema Fields |
|------|---------|-------------------|
| createElements | Ad-hoc shapes (1-30) | type, color?, text? |
| updateElements | Batch-edit by ID | shapeId, newText?, newColor?, resizeInstruction?, moveInstruction?, newName? |
| layoutElements | Arrange existing shapes | shapeIds (min 2), layoutType (grid/row/column/even-spacing) |
| createDiagram | Structured layouts | diagramType (swot/kanban/user_journey/retrospective/custom_frame), title, sections[] |

### Data Flow: AI Generation
1. Frontend gathers ALL page shapes (id, type, x, y, parentId, isSelected, props)
2. POST /api/generate with prompt + boardId + boardState
3. CF Worker verifies JWT, proxies to Hono with X-Internal-Secret
4. Hono agent runs LangChain executor (up to 4 iterations)
5. Returns { toolCalls: ToolCall[], modelUsed?: string }
6. Frontend aiResolver.ts executes tool calls on tldraw Editor
7. Changes sync to other users via WebSocket

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
| 2026-02-22 | Defer CB-001 (batchOperations) — keep current 4-tool architecture | CB-001 implementation caused latency bugs. Current tools work for production. Pivot to viewport/navigation features. |
| 2026-02-22 | F2 smart pan: zoom-to-fit for multi-shape, pan-only for single update | Matches user expectation — show whole structure for creation, just center for edits |
| 2026-02-22 | F3 tiered board state: Option A (single array, props presence distinguishes tiers) | Simpler than explicit viewportShapes/offScreenIndex split. No schema changes. System prompt explains format. |
| 2026-02-22 | F4 no vector DB — LLM does semantic matching on compact index | Board state includes text/name for all shapes. LLM understands "SWOT analysis" = frames named S/W/O/T. Vector DB deferred to 1000+ shape scale. |
| 2026-02-22 | F5 separate /generate-code endpoint, not a board agent tool | Code generation needs a fundamentally different system prompt. Reusing the board agent would confuse tool selection. |
| 2026-02-22 | F5 explicit "Generate Code" button, not heuristic intent detection | Avoids false positives from keyword matching. Clear UX — user explicitly chooses code gen vs board manipulation. |
| 2026-02-22 | F5 floating draggable panel (PiP), not modal | Canvas remains visible and interactive. User sees wireframe + rendered preview simultaneously. |
| 2026-02-22 | F5 React + Tailwind only, no framework selection | Constrained output = higher quality. Framework selection adds complexity with minimal portfolio value. |

## Claude-B Specs Produced

| Spec ID | Description | Priority | Status | Date |
|---------|-------------|----------|--------|------|
| CB-001 | Replace createElements + createDiagram with unified batchOperations tool | P0 | Deferred (latency) | 2026-02-22 |
| CB-002 | Viewport intelligence, navigation, and spatial code generation (5 features) | P0-P1 | In Progress | 2026-02-22 |
| CB-002-F1 | Minimap always visible (localStorage pre-seed) | P0 | Implemented | 2026-02-22 |
| CB-002-F2 | Auto-pan/zoom to AI-created objects (smart camera behavior) | P0 | Implemented | 2026-02-22 |
| CB-002-F3 | Viewport windowing — tiered board state (buildTieredBoardState utility) | P0 | Implemented | 2026-02-22 |
| CB-002-F4 | Semantic camera navigation — navigateToElements tool (5th tool in union) | P0 | Implemented | 2026-02-22 |

## Open Questions

1. ~~**Viewport data**: What camera/viewport API does tldraw expose?~~ **RESOLVED**: tldraw v2 exposes `editor.getViewportPageBounds()`, `editor.zoomToBounds()`, `editor.centerOnPoint()` with animation support.
2. ~~**Object placement**: Objects land at findStartPosition() not in viewport.~~ **ADDRESSED by CB-002 F2**: Auto-pan to created objects after AI generation.
3. **Chat panel lifecycle**: After AI response, panel closes and prompt clears. F2 addresses keeping panel open. Full chat UI redesign deferred.
4. **Board state token cost**: Currently ALL shapes serialized and sent. **ADDRESSED by CB-002 F3**: Viewport windowing with tiered board state.
5. **Semantic search at scale**: For boards with 1000+ shapes, LLM-based matching may hit token limits. Vector DB deferred until scale demands it.

## Session History

### Session 1 — 2026-02-22
**Topics Discussed**: Initial codebase review, Claude-PM activation, batch schema design for P0-B
**Outcome**: CB-001 spec drafted. Implementation attempted but caused latency issues. Reverted.

### Session 2 — 2026-02-22
**Topics Discussed**: Pivot from batch schema to viewport/navigation features. 5 new features designed.

**Decisions Made**:
1. **Defer CB-001** — batchOperations caused latency bugs during implementation. Current 4-tool architecture remains in production.
2. **5 new features prioritized** — F1 (minimap), F2 (auto-pan), F3 (viewport windowing), F4 (semantic navigation), F5 (spatial compiler)
3. **F1 Minimap** — tldraw v2 has built-in NavigationPanel/Minimap. Verify it's rendering, force it on if needed.
4. **F2 Auto-Pan** — Smart behavior: zoom-to-fit (2+ shapes), pan-only (1 shape). 500ms animation. Keep AI panel open after generation.
5. **F3 Viewport Windowing** — Option A: single merged array. Viewport shapes get full props, off-screen shapes get id/type/parentId/text only. Frame children grouped with parent. 10% padding on viewport bounds.
6. **F4 Semantic Navigation** — New `navigateToElements` tool. LLM matches shapes by semantic query against compact index. No vector DB needed at current scale. Uses F2's pan logic.
7. **F5 Spatial Compiler** — Separate /generate-code endpoint. buildSpatialTree() computes containment hierarchy. Floating draggable PiP panel with preview iframe (Tailwind CDN + React UMD). Explicit "Generate Code" button. React + Tailwind only.

**Action Items**:
- CB-002 spec saved to docs/claude-pm/PM-SPEC-CB-002.md
- Ready for developer review
- Implement in order: F1 → F2 → F3 → F4 → F5
- Each feature gets a separate Claude-B prompt for incremental implementation
