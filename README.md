# CollabBoard: AI-First Multiplayer Whiteboard

A high-performance, real-time collaborative whiteboard with AI-powered layout generation.

## Architecture

- **Frontend:** React (Vite) + tldraw SDK + Clerk Auth
- **Backend:** Cloudflare Workers (Edge API)
- **Database/Sync:** Cloudflare Durable Objects + SQLite
- **Shared:** Zod schemas for strict type-safety

## Project Structure

```
CollabBoard/
├── frontend/          # React SPA with Vite
│   ├── src/          # React components
│   ├── public/       # Static assets
│   ├── firebase.json # Firebase Hosting config
│   └── package.json
│
├── backend/          # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts              # Worker entry point
│   │   └── durable-objects/      # Durable Object classes
│   │       └── BoardRoom.ts      # WebSocket sync handler
│   ├── wrangler.toml # Cloudflare Worker config
│   └── package.json
│
├── shared/           # Shared types and Zod schemas
│   ├── src/
│   │   ├── shapes.ts # tldraw shape schemas
│   │   ├── api.ts    # API request/response schemas
│   │   └── index.ts
│   └── package.json
│
└── package.json      # Root workspace config
```

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9
- Cloudflare account (free tier)
- Firebase account (free tier)
- Clerk account (free tier)

### Installation

```bash
# Install all dependencies (including workspaces)
npm install

# Build the shared package first
npm run build:shared
```

### Development

#### 1. Configure Environment Variables

**Frontend (.env):**
```bash
cd frontend
cp .env.example .env
# Edit .env with your Clerk publishable key
```

**Backend (.dev.vars):**
```bash
cd backend
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your Clerk secret key
```

#### 2. Start Development Servers

```bash
# Terminal 1: Start backend (Cloudflare Worker)
npm run dev:backend

# Terminal 2: Start frontend (Vite)
npm run dev:frontend
```

The frontend will be available at `http://localhost:5173`
The backend will be available at `http://localhost:8787`

### Deployment

#### Deploy Frontend (Firebase)

```bash
# Build and deploy frontend
npm run deploy:frontend
```

Your app will be live at: `https://collabboard-mvp.web.app`

#### Deploy Backend (Cloudflare)

```bash
# Set production secrets
cd backend
wrangler secret put CLERK_SECRET_KEY
wrangler secret put ANTHROPIC_API_KEY

# Deploy to Cloudflare Workers
npm run deploy:backend
```

Your API will be live at: `https://collabboard-backend.<your-subdomain>.workers.dev`

## Development Status

### ✅ Phase 0: Foundation (Current)
- [x] Monorepo structure with npm workspaces
- [x] Vite React app configured
- [x] Cloudflare Worker with Durable Objects configured
- [x] Zod schemas for shapes and API
- [x] TypeScript strict mode across all packages

### 🚧 Phase 1: Multiplayer MVP (Next - 24 hours)
- [ ] tldraw canvas integration
- [ ] WebSocket sync via Durable Objects
- [ ] SQLite persistence for board state
- [ ] Clerk authentication
- [ ] Real-time cursors
- [ ] Shape creation and editing
- [ ] Conflict resolution

### 📋 Phase 2: AI Agent (4 days)
- [ ] Anthropic Claude integration
- [ ] AI prompt endpoint with JWT verification
- [ ] Function calling for shape generation
- [ ] AI-generated sticky note layouts

## Tech Stack

| Layer | Technology | Why? |
|-------|-----------|------|
| Frontend Framework | React + Vite | Fast builds, hot reload |
| Canvas Library | tldraw SDK | High-performance infinite canvas with AI support |
| Authentication | Clerk | Drop-in React components, JWT verification |
| Frontend Hosting | Firebase Hosting | Free CDN, global edge, zero-config .web.app subdomain |
| Backend Runtime | Cloudflare Workers | 0ms cold starts, free tier, 30s+ wall time for AI calls |
| Real-time Sync | Cloudflare Durable Objects | Zero-latency embedded SQLite, free tier |
| Type Safety | TypeScript + Zod | Strict validation of all shapes and API calls |
| AI Model | Anthropic Claude | Best-in-class function calling for tool execution |

## Strict Architectural Rules

⚠️ **DO NOT DEVIATE FROM THESE:**

1. **NO TRADITIONAL SERVERS:** No Node.js/Express. Backend is strictly Cloudflare Workers.
2. **NO FIREBASE DATABASE:** Firebase is for hosting ONLY. All data goes to Durable Objects + SQLite.
3. **USE ZOD FOR EVERYTHING:** All tldraw shapes and AI outputs must be validated with Zod.
4. **SECURE THE AI:** Anthropic API is called ONLY from the Worker after JWT verification.

## Resources

- [tldraw Documentation](https://tldraw.dev)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Clerk React SDK](https://clerk.com/docs/quickstarts/react)
- [Anthropic API](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)

## License

MIT
