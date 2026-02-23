# CLAUDE-SE PROMPT: F7 — AI Stats Panel (Token Usage Display)

> **Produced by**: Claude-PM
> **Date**: 2026-02-23
> **Feature**: CB-002-F7 — Display AI token usage and viewport windowing savings
> **Depends on**: F3 viewport windowing (buildTieredBoardState), existing AI generation flow

---

## Context

CB-002-F3 implemented viewport windowing — tiered board state that reduces token cost by sending compact summaries for off-screen shapes. Currently, the only way to see token usage is via LangSmith, which requires switching tabs during presentations.

This feature surfaces AI usage metrics **directly in the board UI** after each AI generation. The user wants presentation-ready stats without tab-switching.

---

## Summary of Changes

| Area | What Changes |
|------|-------------|
| `shared/src/api.ts` | Add optional `usage` object to both AI response schemas |
| `ai-service/src/agent.ts` | Extract token usage from LangChain AgentExecutor, return alongside toolCalls |
| `ai-service/src/codeGenerator.ts` | Extract token usage from LLM response, return alongside code |
| `ai-service/src/index.ts` | Pass `usage` through to response |
| `frontend/src/utils/boardStateBuilder.ts` | Return metrics object alongside shape array |
| `frontend/src/pages/BoardPage.tsx` | Add state for AI stats, compute frontend metrics, render stats bar |

---

## CHANGE 1: Shared Schema — Add `usage` to response schemas

**File**: `shared/src/api.ts`

### 1a. Add `TokenUsageSchema`

Add this new schema **before** the `AIServiceResponseSchema` (around line 116):

```typescript
export const TokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;
```

### 1b. Add `usage` field to `AIServiceResponseSchema`

Update the existing schema (line 117):

```typescript
export const AIServiceResponseSchema = z.object({
  toolCalls: z.array(ToolCallSchema),
  modelUsed: z.string().optional(),
  usage: TokenUsageSchema.optional(),
});
```

### 1c. Add `usage` field to `CodeGenerateResponseSchema`

Update the existing schema (line 294):

```typescript
export const CodeGenerateResponseSchema = z.object({
  code: z.string(),
  modelUsed: z.string().optional(),
  usage: TokenUsageSchema.optional(),
});
```

---

## CHANGE 2: AI Service — Extract token usage from LangChain

### 2a. Agent (`ai-service/src/agent.ts`)

The `runAgent()` function currently returns only `AgentToolCall[]`. Update it to also return token usage.

**Update the return type and function:**

Change the function signature from:
```typescript
export async function runAgent(
  userPrompt: string,
  boardState: unknown[],
  signal?: AbortSignal,
): Promise<AgentToolCall[]> {
```

To:
```typescript
export async function runAgent(
  userPrompt: string,
  boardState: unknown[],
  signal?: AbortSignal,
): Promise<{ toolCalls: AgentToolCall[]; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
```

At the end of the function, after collecting toolCalls from intermediate steps, extract token usage. LangChain's `AgentExecutor` with `returnIntermediateSteps: true` provides intermediate steps but does NOT directly expose aggregate token usage. However, we can use a **callback handler** to accumulate tokens across all LLM calls.

**Add a token-tracking callback** before the executor.invoke() call:

```typescript
  // Track token usage across all LLM calls in this agent run
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  const tokenCallback = {
    handleLLMEnd(output: { llmOutput?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } } }) {
      const usage = output?.llmOutput?.tokenUsage;
      if (usage) {
        totalPromptTokens += usage.promptTokens ?? 0;
        totalCompletionTokens += usage.completionTokens ?? 0;
      }
    },
  };

  const result = await executor.invoke(
    {
      input: userPrompt,
      boardState: JSON.stringify(boardState, null, 2),
    },
    { signal, callbacks: [tokenCallback] },
  );
```

Then update the return statement at the end of the function:

```typescript
  const usage = (totalPromptTokens > 0 || totalCompletionTokens > 0)
    ? { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens: totalPromptTokens + totalCompletionTokens }
    : undefined;

  return { toolCalls, usage };
```

### 2b. Code Generator (`ai-service/src/codeGenerator.ts`)

The `generateCode()` function does a single `llm.invoke()` call. The LangChain `AIMessage` response has `usage_metadata` with token counts.

Update the return type from:
```typescript
): Promise<{ code: string; modelUsed: string }> {
```

To:
```typescript
): Promise<{ code: string; modelUsed: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
```

After the `llm.invoke()` call (around line 194), extract usage from the response:

```typescript
  const response = await llm.invoke(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    { signal },
  );

  // Extract token usage from LangChain response metadata
  const usageMeta = response.usage_metadata;
  const usage = usageMeta
    ? { promptTokens: usageMeta.input_tokens, completionTokens: usageMeta.output_tokens, totalTokens: usageMeta.total_tokens }
    : undefined;
```

Then update the return statement:

```typescript
  return { code, modelUsed, usage };
```

### 2c. Hono Routes (`ai-service/src/index.ts`)

**POST `/generate`** — update to use the new return format:

Find:
```typescript
      const toolCalls = await runAgent(
        prompt,
        boardState ?? [],
        c.req.raw.signal,
      );

      const response = AIServiceResponseSchema.parse({
        toolCalls,
        modelUsed: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      });
```

Replace with:
```typescript
      const result = await runAgent(
        prompt,
        boardState ?? [],
        c.req.raw.signal,
      );

      const response = AIServiceResponseSchema.parse({
        toolCalls: result.toolCalls,
        modelUsed: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        usage: result.usage,
      });
```

**POST `/generate-code`** — no route changes needed since `generateCode()` already returns an object that gets parsed through the schema. The new `usage` field will flow through automatically.

---

## CHANGE 3: Frontend — Board State Metrics

**File**: `frontend/src/utils/boardStateBuilder.ts`

Update `buildTieredBoardState()` to return metrics alongside the shape array. This lets the caller know how many shapes were sent at full detail vs compact.

Change the function signature from:
```typescript
export function buildTieredBoardState(editor: Editor): TieredShape[] {
```

To:
```typescript
export interface BoardStateMetrics {
  totalShapes: number;
  viewportShapes: number;
  offScreenShapes: number;
  tieredSizeChars: number;
  fullSizeChars: number;
}

export function buildTieredBoardState(editor: Editor): { shapes: TieredShape[]; metrics: BoardStateMetrics } {
```

At the end of the function (before the return), compute metrics:

Replace:
```typescript
  // Build tiered array (no x, y coordinates — LLM never uses them)
  return allShapes.map((s): TieredShape => {
```

With:
```typescript
  // Build tiered array (no x, y coordinates — LLM never uses them)
  const viewportCount = viewportIds.size;
  const totalCount = allShapes.length;

  const tieredShapes = allShapes.map((s): TieredShape => {
```

And replace the final `return` (around line 92) to compute sizes and return the metrics object:

```typescript
  const tieredJson = JSON.stringify(tieredShapes);

  // Estimate full-detail size: what would be sent without viewport windowing
  const fullShapes = allShapes.map((s) => {
    const props = (s as unknown as Record<string, unknown>).props as Record<string, unknown>;
    return {
      id: s.id, type: s.type, parentId: s.parentId as string,
      isSelected: selectedIds.has(s.id), props,
    };
  });
  const fullJson = JSON.stringify(fullShapes);

  return {
    shapes: tieredShapes,
    metrics: {
      totalShapes: totalCount,
      viewportShapes: viewportCount,
      offScreenShapes: totalCount - viewportCount,
      tieredSizeChars: tieredJson.length,
      fullSizeChars: fullJson.length,
    },
  };
```

---

## CHANGE 4: Frontend — AI Stats State and UI

**File**: `frontend/src/pages/BoardPage.tsx`

### 4a. Add state for AI stats

After the existing state declarations (around line 148, after `selectedCount`), add:

```typescript
  const [aiStats, setAiStats] = useState<{
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    modelUsed?: string;
    durationMs: number;
    totalShapes: number;
    viewportShapes: number;
    offScreenShapes: number;
    savedPercent: number;
  } | null>(null);
```

### 4b. Update `handleAiGenerate()` to collect and set stats

In the `handleAiGenerate()` function (starts around line 168), make these changes:

**1. Record start time** — add right after the early return guards:

```typescript
    const startTime = Date.now();
```

**2. Update buildTieredBoardState call** — the function now returns `{ shapes, metrics }`:

Find:
```typescript
    const shapes = buildTieredBoardState(editorRef.current);
```

Replace with:
```typescript
    const { shapes, metrics } = buildTieredBoardState(editorRef.current);
```

**3. Update the fetch body** — use `shapes` (unchanged variable name in the body):

The fetch body `boardState: shapes` stays the same since `shapes` is now just the array portion.

**4. Extract usage from response** — update the response handling:

Find:
```typescript
    const data = await res.json() as { toolCalls: unknown[] };
```

Replace with:
```typescript
    const data = await res.json() as { toolCalls: unknown[]; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; modelUsed?: string };
```

**5. Set stats after camera animation** — add after the camera animation block (after the `else if (validBounds.length === 1)` block), right before the catch:

```typescript
    // Set AI stats for display
    const durationMs = Date.now() - startTime;
    const savedPercent = metrics.fullSizeChars > 0
      ? Math.round((1 - metrics.tieredSizeChars / metrics.fullSizeChars) * 100)
      : 0;
    setAiStats({
      promptTokens: data.usage?.promptTokens,
      completionTokens: data.usage?.completionTokens,
      totalTokens: data.usage?.totalTokens,
      modelUsed: data.modelUsed,
      durationMs,
      totalShapes: metrics.totalShapes,
      viewportShapes: metrics.viewportShapes,
      offScreenShapes: metrics.offScreenShapes,
      savedPercent: Math.max(0, savedPercent),
    });
```

### 4c. Render the stats bar

Add this JSX **inside the AI panel** (`aiPanelOpen && (...)` block), right after the Generate button (after line 828), before the closing `</div>` of the panel:

```tsx
            {aiStats && !aiLoading && (
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: '#f8fafc', border: '1px solid #e2e8f0',
                fontSize: 11, color: '#475569', lineHeight: 1.6,
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: '#334155' }}>AI Stats</span>
                  <button
                    onClick={() => setAiStats(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14, padding: 0 }}
                  >
                    x
                  </button>
                </div>

                {aiStats.totalTokens != null && (
                  <div>
                    <span style={{ fontWeight: 600 }}>Tokens:</span>{' '}
                    {aiStats.promptTokens?.toLocaleString()} prompt + {aiStats.completionTokens?.toLocaleString()} completion = {aiStats.totalTokens.toLocaleString()} total
                  </div>
                )}

                <div>
                  <span style={{ fontWeight: 600 }}>Board state:</span>{' '}
                  {aiStats.viewportShapes}/{aiStats.totalShapes} shapes sent with full detail
                  {aiStats.offScreenShapes > 0 && (
                    <span> ({aiStats.offScreenShapes} off-screen compressed)</span>
                  )}
                </div>

                {aiStats.savedPercent > 0 && (
                  <div style={{ color: '#059669', fontWeight: 600 }}>
                    Viewport windowing saved ~{aiStats.savedPercent}% of board state tokens
                  </div>
                )}

                <div style={{ color: '#94a3b8', fontSize: 10 }}>
                  {aiStats.modelUsed ?? 'unknown model'} &middot; {(aiStats.durationMs / 1000).toFixed(1)}s
                </div>
              </div>
            )}
```

### 4d. Clear stats on new generation

In the `handleAiGenerate()` function, right after `setAiError(null)` (line 173), add:

```typescript
    setAiStats(null);
```

This clears previous stats when a new generation starts.

---

## CHANGE 5: Rebuild shared package

After modifying `shared/src/api.ts`:

```bash
cd shared && npm run build
```

---

## Testing Checklist

1. **`cd shared && npm run build`** — shared package compiles with new TokenUsageSchema
2. **`cd ai-service && npx tsc --noEmit`** — AI service compiles with updated return types
3. **`cd frontend && npx tsc --noEmit`** — frontend compiles with updated boardStateBuilder return type
4. **Manual test — small board (few shapes, all in viewport)**:
   - Generate AI content → stats bar appears in AI panel
   - Shows "X/X shapes sent with full detail" (all in viewport)
   - savedPercent should be 0% or very low
   - Token counts display (if OpenRouter returns usage)
   - Duration displays correctly
5. **Manual test — large board (shapes spread out, some off-screen)**:
   - Pan to one area, generate → stats show N/M shapes (N < M)
   - "Viewport windowing saved ~XX% of board state tokens" line appears in green
   - This is the key presentation metric
6. **Stats dismissal**: Click "x" on stats bar → it disappears
7. **Stats clearing**: Type new prompt and generate → old stats clear, new stats appear after response
8. **Token data graceful degradation**: If OpenRouter doesn't return usage metadata, the "Tokens:" line should not render (the `aiStats.totalTokens != null` guard handles this)
9. **Existing tests still pass** — regression check

---

## Presentation Flow

With this feature, during a demo the user can:
1. Create a large board with many shapes spread across the canvas
2. Pan to one area with a few shapes
3. Run an AI prompt
4. The stats bar shows: "5/42 shapes sent with full detail (37 off-screen compressed)" + "Viewport windowing saved ~74% of board state tokens"
5. No need to open LangSmith — the key metric is right there in the UI

---

## Files Modified (Summary)

| File | Action |
|------|--------|
| `shared/src/api.ts` | Add TokenUsageSchema. Add `usage` to AIServiceResponseSchema and CodeGenerateResponseSchema. |
| `ai-service/src/agent.ts` | Add callback handler to track tokens. Return `{ toolCalls, usage }`. |
| `ai-service/src/codeGenerator.ts` | Extract `response.usage_metadata`. Return `{ code, modelUsed, usage }`. |
| `ai-service/src/index.ts` | Update `/generate` handler to use `result.toolCalls` and `result.usage`. |
| `frontend/src/utils/boardStateBuilder.ts` | Return `{ shapes, metrics }` with shape counts and size comparison. |
| `frontend/src/pages/BoardPage.tsx` | Add `aiStats` state. Compute metrics in `handleAiGenerate`. Render stats bar in AI panel. |
