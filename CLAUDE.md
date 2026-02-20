# CollabBoard: AI-First Multiplayer Whiteboard

## Project Context

This is a monorepo containing a real-time collaborative whiteboard with a split AI architecture.

- **Frontend:** React (Vite) + `tldraw` SDK + Clerk Auth.
- **CF Worker (backend/):** Cloudflare Workers — WebSocket sync, Clerk JWT auth, REST routing, D1 metadata.
- **AI Service (ai-service/):** Dockerized Hono microservice on Render — LangChain + OpenRouter + LangSmith.
- **Database/Sync:** Cloudflare Durable Objects + embedded SQLite.
- **Shared:** Zod schemas for strict type-safety across the stack.

## Strict Architectural Rules (DO NOT DEVIATE)

1. **CF WORKER STAYS LEAN:** The Cloudflare Worker handles WebSockets, Clerk JWT verification, REST routing to D1, and proxying AI requests. It does NOT contain AI/LLM logic.
2. **AI LIVES IN THE HONO SERVICE:** All LangChain, OpenRouter, and LangSmith code belongs exclusively in `ai-service/`. The service is built with **Hono** on **@hono/node-server** and runs in a Docker container on Render. Do NOT use Express or Fastify.
3. **NO FIREBASE DATABASE:** Firebase is for static frontend hosting only. All real-time WebSocket sync and data storage MUST use Cloudflare Durable Objects with the SQLite backend.
4. **USE ZOD FOR EVERYTHING:** All `tldraw` shapes and AI JSON outputs must be strictly validated using `zod` schemas in `shared/` and enforced at the Hono layer with `@hono/zod-validator`. Do not trust raw LLM outputs.
5. **SECURE THE AI:** The CF Worker verifies the user's Clerk JWT before forwarding the request to the Hono AI service. The Hono service trusts an internal `X-Internal-Secret` header — it must never be called directly by the browser.
6. **NO VERSION CONTROL:** Do not run git commits, branch creations, or pushes. The user will handle all Git operations manually.

## Structure

- `/frontend`: The Vite React SPA.
- `/backend`: The Cloudflare Worker (`wrangler.toml` lives here).
- `/ai-service`: The Dockerized Hono AI microservice (Node.js, Render).
- `/shared`: Shared TypeScript interfaces and Zod schemas.
