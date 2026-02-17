CollabBoard: Architecture & Pre-Search Summary
High-Level Concept
CollabBoard is a high-performance, real-time collaborative whiteboard designed to solve complex synchronization problems without merge conflicts. The project features an "AI-First" methodology, integrating an AI agent capable of manipulating the infinite canvas, creating shapes, and organizing data via natural language commands.
The sprint prioritizes a bulletproof multiplayer experience over a feature-heavy but broken board.

Pre-Search Checklist Answers (Updated)
Phase 1: Define Your Constraints

1. Scale & Load Profile
   Users at launch: 5+ concurrent users per session.
   Traffic Pattern: Spiky. Usage will drop to near zero between collaborative sessions, followed by bursts of high concurrency when teams meet
   Cold Start Tolerance: Very Low for the real-time canvas (must load instantly). Moderate for the AI Agent (users will accept a 2–4 second delay for AI generation, but standard serverless cold starts of 10+ seconds are unacceptable).
2. Budget & Cost Ceiling
   Budget: $0 for infrastructure, plus the Claude Code MAX plan subscription, plus AI API (Anthropic Claude) cost.
   Model: Hybrid. We will use pay-per-use for the AI API (Anthropic Claude). All hosting, database, and WebSocket infrastructure will utilize generous free tiers to keep fixed costs at absolute zero.
   Trading Money for Time: We are utilizing the Claude Code MAX plan to dramatically accelerate frontend layout and boilerplate generation.
3. Time to Ship
   Timeline: 24 hours for the core multiplayer MVP; 4 days for the full AI feature set.
   Priority: Speed-to-market and bulletproof multiplayer sync.
4. Compliance & Regulatory Needs
   None for MVP. No HIPAA, GDPR, or SOC 2 compliance is required for this sprint.
5. Team & Skill Constraints
   Team: Solo developer utilizing an AI-first methodology (Claude Code CLI).
   Preference: Shipping speed over deep-dive learning, utilizing familiar JavaScript/TypeScript stacks.
   Phase 2: Architecture Discovery
6. Hosting & Deployment
   Frontend: Firebase Hosting (Free, global CDN, zero-config deployment via web.app subdomain).
   Backend: Cloudflare Workers (Free tier, Global Edge deployment with 0ms cold starts via workers.dev subdomain).
7. Authentication & Authorization
   Tool: Clerk (Drop-in React UI components and JWT verification).
   Strategy: Clerk will handle the UI, and we will use Clerk’s built-in Firebase JWT integration to securely bridge the auth state to our database rules.
8. Database & Data Layer
   Tool: Cloudflare Durable Objects (SQLite Backend).
   Why: Runs in the exact same thread as the application code, providing zero-latency reads/writes for fast-moving cursors and native integration with the tldraw sync engine on the free tier.
9. Backend/API Architecture
   Type: Serverless Edge Functions (Cloudflare Workers).
   Purpose: To act as a consolidated backend. It will route WebSockets to the Durable Object for multiplayer sync, and handle standard HTTP REST requests to securely execute Anthropic AI prompts.
   "It is a Serverless Edge API utilizing Cloudflare Workers for AI orchestration, paired with distributed Durable Objects and embedded SQLite for real-time WebSocket state."
10. Frontend Framework & Rendering
    Stack: React + tldraw SDK.
    Architecture: Single Page Application (SPA). Client-side rendering is ideal here because the entire app relies on a highly interactive, stateful canvas.
    Tradeoff: Naive React DOM rendering is too slow for 500+ whiteboard objects. tldraw bypasses this DOM bottleneck using a highly optimized custom state store and CSS transforms while maintaining React compatibility.
11. Third-Party Integrations
    Claude API via Anthropic (for Function Calling/Tool Execution).
    Clerk (for Authentication).

Phase 3: Post-Stack Refinement 12. Security Vulnerabilities
Prompt Injection: Prevented by strictly enforcing AI "tools" via structured JSON schemas on the Node.js backend rather than raw string execution.
Database Takeover: MVP will immediately implement Firebase Security Rules requiring valid custom Clerk JWTs before allowing read/write access to the board state.
Phase 3: Post-Stack Refinement 12. Security Vulnerabilities
Prompt Injection: Prevented by strictly enforcing AI "tools" via structured JSON schemas in the Cloudflare Worker, rather than executing raw string commands.
Unauthorized AI Execution (The JWT Check): The React frontend will send the user's Clerk session token in the Authorization header. Our Cloudflare Worker will use the @clerk/backend SDK to cryptographically verify that token before executing any expensive Anthropic API calls. 13. File Structure & Project Organization
Structure: Monorepo (npm workspaces) with three main directories: frontend/, backend/, and shared/.
Why: The shared/ folder will hold the TypeScript interfaces and Zod schemas for the tldraw whiteboard objects. This ensures that the React UI and the Cloudflare AI Agent are speaking the exact same "language" when the AI attempts to draw a shape. 14. Naming Conventions & Code Style
Strategy: Standard ESLint + Prettier.
Enforcement: We will heavily rely on a CLAUDE.md system prompt file placed at the root of the project. This tells the Claude Code CLI exactly how to write and format our code so we don't have to manually correct its styling preferences. 15. Testing Strategy
Multiplayer Sync Testing: Multiple browser windows (incognito) side-by-side to test the Cloudflare Durable Objects conflict resolution and latency.
Cost Testing: Initial AI function-calling tests will use a mocked (hardcoded) LLM response in the Cloudflare Worker. This prevents us from accidentally burning real Anthropic API credits while just trying to get the React UI to update. 16. Recommended Tooling & DX
CLI Agent: Claude Code CLI (installed natively on macOS via bash script, not npm).
IDE & Agent: VS Code with the Claude Code plugin. This provides tight integration with our chosen AI model and allows for rapid, context-aware code generation directly within our editor.
Why: It lives entirely in the Mac terminal, autonomously navigates the monorepo, writes code, and can even run wrangler deploy or npm run build with your permission.

# Architecture Decision Log: CollabBoard

## 1. Frontend Framework & Canvas Rendering

- **The Dilemma:** Standard React is great for UI but suffers from DOM performance bottlenecks when rendering hundreds of moving whiteboard objects (like sticky notes and cursors) simultaneously.
- **Options Considered:** Pure React (too slow for canvas), Excalidraw (great privacy and sketchy aesthetic, but harder to customize for AI), tldraw (React-friendly, highly extensible SDK).
- **Decision:** **React + tldraw SDK**.
- **Rationale:** tldraw bypasses the React DOM bottleneck by using a custom signals store and CSS transforms for high performance. Most importantly, it treats canvas elements as data-rich React components and includes built-in AI agent support, making it the perfect foundation for an AI-first sprint.

## 2. Real-Time Sync & Database Layer

- **The Dilemma:** Building perfect real-time sync with conflict resolution from scratch is extremely difficult. We are also barred from using fully managed multiplayer frameworks (like Liveblocks) and must avoid the "cost cliffs" associated with traditional DBs (like Firebase) processing 60 FPS cursor movements.
- **Options Considered:** Firebase Realtime Database, Supabase, Convex, Cloudflare Durable Objects.
- **Decision:** **Cloudflare Durable Objects (SQLite Backend)**.
- **Rationale:** Because Cloudflare recently opened SQLite-backed Durable Objects to the Free Tier, this is the ultimate solution. Every whiteboard room spins up a dedicated mini-server at the Edge. Because the embedded SQLite database runs in the _exact same thread_ as the WebSocket connection, latency is essentially zero. It avoids complex conflict resolution and costs exactly $0.
- _Bonus:_ The creators of `tldraw` actively maintain a sync template explicitly built for this exact Cloudflare SQLite architecture.

## 3. Backend & AI Orchestration

- **The Dilemma:** The AI agent needs a secure environment to call the Anthropic API without exposing secret keys to the browser. Furthermore, standard serverless free tiers (like Vercel) have a strict 10-second timeout, which kills long-running AI generation requests.
- **Options Considered:** Render ($20/mo to avoid sleep), Koyeb (Free but traditional container), Vercel (10s timeout limit), Cloudflare Workers.
- **Decision:** **Cloudflare Workers**.
- **Rationale:** By using Cloudflare Workers, we consolidate our backend. It routes both our WebSockets and our AI API requests. Most importantly, Cloudflare limits free tiers based on _CPU time_ (10ms) rather than _Wall time_. The Worker can safely wait 30+ seconds for the Anthropic API to generate a complex board layout without timing out.

## 4. Hosting & Domains

- **The Dilemma:** We need to host two distinct codebases (Frontend SPA + Backend Edge Worker) and want to avoid paying $10–$20 for a domain name just for a one-week MVP sprint.
- **Decision:** **Firebase Hosting (`.web.app`) + Cloudflare Workers (`.workers.dev`)**.
- **Rationale:** We bypass registrars entirely. Firebase automatically provisions a free, SSL-secured `.web.app` subdomain for the frontend SPA. Cloudflare provides a free `.workers.dev` subdomain for the backend API and WebSockets. This keeps our total infrastructure spend at $0 while remaining highly professional.

## 5. Development Tooling & Workflow

- **Decision:** **Claude Code CLI** within a **Monorepo** structure.
- **Rationale:** A monorepo ensures our React frontend and Cloudflare backend share the exact same JSON schemas for whiteboard tools. Using Anthropic's native Mac terminal agent (`claude-code`) allows the AI to autonomously read our architecture constraints, execute bash commands, and scaffold the boilerplate across both the frontend and backend simultaneously.

## 6. Tooling & Developer Experience \* **The Dilemma:** Keeping the frontend and backend in sync, preventing AI prompt hallucinations, and moving fast as a solo developer.

- **Decision:** **VS Code + Claude Code MAX plugin + Claude Code CLI + Zod + Monorepo**.
- **Rationale:** A monorepo ensures our React frontend and Cloudflare backend share the exact same Zod schemas for whiteboard tools (protecting us from malformed AI outputs). Using Anthropic's native Mac terminal agent (`claude-code`) allows the AI to autonomously read our architecture constraints, execute bash commands, and scaffold the boilerplate across both ends of the stack simultaneously. We utilize VS Code for our IDE and the Claude Code MAX plugin for VS code.
