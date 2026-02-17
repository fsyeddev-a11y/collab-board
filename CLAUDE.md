# CollabBoard: AI-First Multiplayer Whiteboard

## Project Context

This is a monorepo containing a real-time collaborative whiteboard. It features AI-generated sticky note layouts via Anthropic.

- **Frontend:** React (Vite) + `tldraw` SDK + Clerk Auth.
- **Backend:** Cloudflare Workers (Edge API).
- **Database/Sync:** Cloudflare Durable Objects + embedded SQLite.
- **Shared:** Zod schemas for strict type-safety across the stack.

## Strict Architectural Rules (DO NOT DEVIATE)

1. **NO TRADITIONAL SERVERS:** Do not write Node.js/Express code. The backend is strictly a Cloudflare Worker using native `fetch` event handlers.
2. **NO FIREBASE DATABASE:** We only use Firebase for static frontend hosting. All real-time WebSocket sync and data storage MUST use Cloudflare Durable Objects with the SQLite backend.
3. **USE ZOD FOR EVERYTHING:** All `tldraw` shapes and AI JSON outputs must be strictly validated using `zod` schemas in a `shared/` directory. Do not trust raw LLM outputs.
4. **SECURE THE AI:** The Anthropic API is only called from the Cloudflare Worker. The Worker must verify the user's Clerk JWT before executing the LLM call.

## Structure

- `/frontend`: The Vite React SPA.
- `/backend`: The Cloudflare Worker (`wrangler.toml` lives here).
- `/shared`: Shared TypeScript interfaces and Zod schemas.
