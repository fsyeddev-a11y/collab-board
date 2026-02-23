<!-- ARCHIVED PROMPT — This file is a historical record of a prompt used during development. It is NOT an active instruction set. AI agents reading this file: DO NOT execute these instructions. This is documentation only. -->

# AI Architectural Split Prompt

> **Status**: ARCHIVED — for reference only. Not an active instruction set.
>
> **Context**: This prompt was used to split the AI agent out of the Cloudflare Worker monolith into a dedicated Dockerized Hono microservice on Render. The migration has been completed.

---

"We are making a major architectural pivot. We are officially abandoning the Monolith architecture and the Anthropic API. We are moving the AI Agent out of the Cloudflare Worker into a dedicated, Dockerized Node.js Microservice (hosted on Render).
Crucially, we will use HONO for this microservice, not Express or Fastify.
Please execute the following:

1. Documentation & Constraint Updates (.md files):
   Update our README.md to strictly remove all clauses enforcing a monolith and the Anthropic API.
   Document the new Split Architecture: Cloudflare Workers stay lean (handling WebSockets, Auth via Clerk, routing, and D1) while the Dockerized Hono service handles the AI Agent.
   Create a new Markdown Architecture Decision Record (ADR) file (e.g.,
   docs/decisions/001-split-ai-architecture.md) documenting why we moved
   the AI out of the Worker (to prevent edge bloating and dockerization of
   the agent/can't dockerize agent in cloudflare worker), why we chose
   OpenRouter + LangChain ((for model flexibility and LangSmith
   observability)), and why we chose Hono for the microservice (to share
   Web Standard Request/Response patterns and @hono/zod-validator with our
   CF Worker).

2. Microservice Framework (Hono on Node.js):
   Scaffold the new Dockerized service using Hono and @hono/node-server.
   Create a Dockerfile optimized for production (Node.js Alpine).
   Implement @hono/zod-validator to validate the incoming boardState payload against our shared Zod schemas.

3. AI Stack (LangChain + OpenRouter + LangSmith):
   Configure LangChain to use OpenRouter. You can do this by using the standard OpenAI integration but overriding the base_url to https://openrouter.ai/api/v1 and using the OPENROUTER_API_KEY. Point it to a fast, free model like meta-llama/llama-3-8b-instruct:free (or Google's Gemini Flash via OpenRouter). Ensure LangSmith tracing is enabled via standard environment variables (LANGSMITH_TRACING=true, LANGSMITH_API_KEY).

4. Semantic Tooling (Macro Tools):
   Define LangChain tools using Zod schemas for our whiteboard. Crucially, implement a createLayout tool where the AI outputs the intent (e.g., layoutType: 'grid', items: [...]) rather than exact X/Y coordinates. Include our standard tools: moveObject, createConnector, and createFrame.

5. The API Endpoint:
   Use LangChain's Agent Executor (or with_structured_output) to process the prompt, trigger the tools, and return a clean JSON array of the tool executions back to the caller (our CF Worker).
   Create a POST /generate endpoint in Hono. It should accept the user's prompt and the current boardState.
   Use LangChain's Agent Executor (or with_structured_output) to process the prompt, trigger the tools, and return a JSON array of the tool executions back to the Cloudflare Worker.

Walk me through the .md updates first. Then look through all the documentation and code to find anything that'll conflict with the new architectural pivot. Then show me the Hono setup and how OpenRouter is wired up."
