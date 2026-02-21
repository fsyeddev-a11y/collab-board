import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { timeout } from 'hono/timeout';
import { zValidator } from '@hono/zod-validator';
import { AIServiceRequestSchema, AIServiceResponseSchema } from '@collabboard/shared';
import { runAgent, getLLM } from './agent.js';

// ── Environment checks ───────────────────────────────────────────────────────

const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
const PORT = Number(process.env.PORT ?? 3001);

if (!INTERNAL_SECRET) {
  console.error('FATAL: INTERNAL_SECRET env var is not set');
  process.exit(1);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.error('FATAL: OPENROUTER_API_KEY env var is not set');
  process.exit(1);
}

console.log('[ai-service] LangSmith config:', {
  LANGCHAIN_TRACING_V2: process.env.LANGCHAIN_TRACING_V2 ?? '(not set)',
  LANGCHAIN_API_KEY: process.env.LANGCHAIN_API_KEY ? '***set***' : '(not set)',
  LANGCHAIN_PROJECT: process.env.LANGCHAIN_PROJECT ?? '(not set)',
});

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

// 45s wall-time timeout — agent loops + LLM latency can be long.
app.use('/generate', timeout(45_000));

// Internal auth — only our CF Worker may call this.
app.use('/generate', async (c, next) => {
  const secret = c.req.header('x-internal-secret');
  if (!secret || secret !== INTERNAL_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

// Health check (no auth — used by Render).
app.get('/health', (c) => c.json({ status: 'ok' }));

// Warmup endpoint (no auth — called by Render cron or external pinger).
// Initialises the LLM singleton so the first real /generate isn't slow.
app.get('/warmup', (c) => {
  const start = Date.now();
  getLLM(); // initialise singleton if not already
  const elapsed = Date.now() - start;
  return c.json({ status: 'warm', llmInitMs: elapsed });
});

// POST /generate — main AI endpoint.
app.post(
  '/generate',
  zValidator('json', AIServiceRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid request', issues: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const { prompt, boardState } = c.req.valid('json');

    try {
      // Pass the request's AbortSignal so the agent stops if the client disconnects.
      const toolCalls = await runAgent(
        prompt,
        boardState ?? [],
        c.req.raw.signal,
      );

      const response = AIServiceResponseSchema.parse({
        toolCalls,
        modelUsed: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      });

      return c.json(response);
    } catch (err) {
      console.error('[/generate] Agent error:', err);
      const message =
        err instanceof Error ? err.message : 'Agent execution failed';
      return c.json({ error: message }, 500);
    }
  },
);

// ── Start ─────────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[ai-service] Listening on port ${PORT}`);
});
