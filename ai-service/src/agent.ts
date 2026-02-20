import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

// ── OpenRouter LLM (singleton) ────────────────────────────────────────────────
//
// ChatOpenAI + custom baseURL → OpenRouter's OpenAI-compatible endpoint.
//
// LangSmith tracing activates automatically via env vars:
//   LANGCHAIN_TRACING_V2=true
//   LANGCHAIN_API_KEY=ls__...
//   LANGCHAIN_PROJECT=collabboard

let _llm: ChatOpenAI | null = null;

function getLLM(): ChatOpenAI {
  if (!_llm) {
    _llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENROUTER_API_KEY,
      modelName:
        process.env.OPENROUTER_MODEL ??
        'google/gemini-2.5-flash-preview-05-20',
      temperature: 0.2,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://collabboard.pages.dev',
          'X-Title': 'CollabBoard AI Agent',
        },
      },
    });
  }
  return _llm;
}

// ── Ref-ID counter ────────────────────────────────────────────────────────────
//
// Each /generate request gets its own counter so the agent can create shapes in
// step 1 (e.g. ref:frame_1) and reference them in step 2 (e.g. nest notes
// inside ref:frame_1).  The frontend resolves ref IDs to real tldraw shape IDs
// when it applies the tool calls to the canvas.

function makeRefCounter() {
  let n = 0;
  return (prefix: string) => `ref:${prefix}_${++n}`;
}

// ── Tool colour palette (matches tldraw) ──────────────────────────────────────

const TL_COLORS = [
  'yellow',
  'green',
  'blue',
  'orange',
  'red',
  'violet',
  'light-blue',
  'light-green',
  'light-red',
  'light-violet',
  'grey',
  'white',
] as const;

const TLColorEnum = z.enum(TL_COLORS);

// ── Macro Tools ───────────────────────────────────────────────────────────────
//
// Every tool returns a JSON string.  The string becomes the "observation" that
// the AgentExecutor feeds back to the LLM, letting it reason about what it
// planned so far and chain subsequent calls.
//
// Tools output INTENT — the frontend resolves layout geometry.

function buildTools(nextRef: (prefix: string) => string) {
  const createLayout = new DynamicStructuredTool({
    name: 'createLayout',
    description:
      'Create a structured layout of sticky notes. Use this for brainstorming, ' +
      'organising ideas, listing items, or populating a column/section. ' +
      'If targetFrameRef is provided, the notes are placed inside that frame.',
    schema: z.object({
      layoutType: z
        .enum(['grid', 'columns', 'mindmap', 'timeline', 'list'])
        .describe(
          'grid: equal rows/cols; columns: vertical stacks grouped by heading; ' +
          'mindmap: central node with branches; timeline: left-to-right; ' +
          'list: simple vertical list',
        ),
      items: z
        .array(
          z.object({
            text: z.string().describe('Content of the sticky note'),
            color: TLColorEnum.nullable().optional().describe('tldraw colour, or null for default'),
          }),
        )
        .min(1)
        .max(30),
      frameLabel: z
        .string()
        .nullable()
        .optional()
        .describe(
          'If set AND targetFrameRef is NOT set, wrap the layout in a new labelled frame. ' +
          'Ignored when targetFrameRef is provided (the frame already exists). Null if not needed.',
        ),
      targetFrameRef: z
        .string()
        .nullable()
        .optional()
        .describe(
          'A ref ID from a previous createFrame call (e.g. "ref:frame_1"). ' +
          'The notes will be nested inside this frame. Null if not targeting a frame.',
        ),
    }),
    func: async (input) => {
      const layoutRef = nextRef('layout');
      const frameRef =
        input.targetFrameRef ?? (input.frameLabel ? nextRef('frame') : undefined);

      const result = {
        tool: 'createLayout' as const,
        ref: layoutRef,
        frameRef,
        ...input,
      };

      // Observation the agent sees — lets it know what ref IDs were assigned.
      const noteCount = input.items.length;
      const frameNote = frameRef
        ? ` inside frame ${frameRef} ("${input.targetFrameRef ? 'existing' : input.frameLabel}")`
        : '';
      return JSON.stringify({
        _observation: `Planned ${input.layoutType} layout ${layoutRef} with ${noteCount} notes${frameNote}.`,
        ...result,
      });
    },
  });

  const createFrame = new DynamicStructuredTool({
    name: 'createFrame',
    description:
      'Create a labelled frame (container/section) on the board. Returns a ref ' +
      'ID you can pass as targetFrameRef to createLayout to add notes inside it. ' +
      'Use this to set up columns, sections, or groups BEFORE populating them.',
    schema: z.object({
      label: z.string().describe('Display name shown on the frame header'),
      position: z
        .enum(['auto', 'left', 'center', 'right', 'far-right'])
        .describe(
          'Hint for horizontal placement. "auto" lets the frontend decide. ' +
          'Use left/center/right/far-right when creating multiple side-by-side frames.',
        ),
      size: z
        .enum(['small', 'medium', 'large'])
        .describe('Hint for frame dimensions'),
    }),
    func: async (input) => {
      const ref = nextRef('frame');
      const result = { tool: 'createFrame' as const, ref, ...input };
      return JSON.stringify({
        _observation: `Planned frame ${ref} ("${input.label}") at position=${input.position}, size=${input.size}. Use targetFrameRef="${ref}" in createLayout to add notes inside it.`,
        ...result,
      });
    },
  });

  const createConnector = new DynamicStructuredTool({
    name: 'createConnector',
    description:
      'Draw an arrow between two shapes or ref IDs. Use to show ' +
      'relationships, flows, or dependencies.',
    schema: z.object({
      fromRef: z
        .string()
        .describe('Source shape ID or ref ID (e.g. "ref:frame_1" or "shape:abc")'),
      toRef: z
        .string()
        .describe('Target shape ID or ref ID'),
      label: z.string().nullable().optional().describe('Optional text label on the arrow, or null'),
    }),
    func: async (input) => {
      const ref = nextRef('arrow');
      const result = { tool: 'createConnector' as const, ref, ...input };
      return JSON.stringify({
        _observation: `Planned connector ${ref}: ${input.fromRef} → ${input.toRef}${input.label ? ` ("${input.label}")` : ''}.`,
        ...result,
      });
    },
  });

  const moveObject = new DynamicStructuredTool({
    name: 'moveObject',
    description:
      'Reposition an existing shape on the board. Uses semantic ' +
      'directions instead of pixel coordinates.',
    schema: z.object({
      shapeId: z
        .string()
        .describe('The tldraw shape ID to move (from the board state)'),
      direction: z
        .enum(['left', 'right', 'up', 'down'])
        .describe('Direction to move'),
      distance: z
        .enum(['small', 'medium', 'large'])
        .describe('How far to move (small ≈ 50px, medium ≈ 150px, large ≈ 300px)'),
    }),
    func: async (input) => {
      const result = { tool: 'moveObject' as const, ...input };
      return JSON.stringify({
        _observation: `Planned move: ${input.shapeId} → ${input.direction} (${input.distance}).`,
        ...result,
      });
    },
  });

  return [createFrame, createLayout, createConnector, moveObject];
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI assistant that builds layouts on a collaborative whiteboard.

## Available tools

1. **createFrame** — create a labelled section/container. Returns a ref ID.
2. **createLayout** — place sticky notes in a structured pattern (grid, columns, mindmap, timeline, list). Can target an existing frame via targetFrameRef.
3. **createConnector** — draw an arrow between two shapes or refs.
4. **moveObject** — reposition an existing shape by semantic direction.

## How to plan multi-step operations

For complex requests, THINK STEP BY STEP:

1. **Create frames first** — if the user wants columns, sections, or groups, call createFrame for each one. Note the ref IDs returned.
2. **Populate frames** — call createLayout with targetFrameRef pointing to each frame's ref ID.
3. **Connect things** — call createConnector to draw arrows if the user wants flows or relationships.

### Example: "Set up a retrospective board with 3 columns"

Step 1: createFrame(label="What Went Well", position="left")    → ref:frame_1
Step 2: createFrame(label="What Didn't Go Well", position="center") → ref:frame_2
Step 3: createFrame(label="Action Items", position="right")     → ref:frame_3
Step 4: createLayout(layoutType="list", targetFrameRef="ref:frame_1", items=[starter notes...])
Step 5: createLayout(layoutType="list", targetFrameRef="ref:frame_2", items=[starter notes...])
Step 6: createLayout(layoutType="list", targetFrameRef="ref:frame_3", items=[starter notes...])

### Example: "Build a user journey map with 5 stages"

Step 1: createFrame for each stage (Awareness, Consideration, Purchase, Retention, Advocacy)
Step 2: createLayout inside each frame with relevant touchpoints
Step 3: createConnector between consecutive stages

## Rules

1. Always use tools. Never return plain text as your final answer.
2. Create frames BEFORE populating them with createLayout.
3. Use the ref IDs from previous tool calls to chain operations.
4. When the user provides board state, reference existing shape IDs from it.
5. Pick sensible defaults: frame positions should flow left-to-right, colours should vary for visual distinction.
6. For brainstorming prompts, generate 3-6 realistic starter items per section.`;

// ── Prompt template ───────────────────────────────────────────────────────────

const PROMPT = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  [
    'human',
    'Current board state (JSON, may be empty):\n{boardState}\n\nUser request: {input}',
  ],
  new MessagesPlaceholder('agent_scratchpad'),
]);

// ── Public interface ──────────────────────────────────────────────────────────

export interface AgentToolCall {
  tool: string;
  ref?: string;
  frameRef?: string;
  [key: string]: unknown;
}

export async function runAgent(
  userPrompt: string,
  boardState: unknown[],
  signal?: AbortSignal,
): Promise<AgentToolCall[]> {
  const nextRef = makeRefCounter();
  const tools = buildTools(nextRef);
  const llm = getLLM();

  const agent = await createToolCallingAgent({ llm, tools, prompt: PROMPT });

  const executor = new AgentExecutor({
    agent,
    tools,
    returnIntermediateSteps: true,
    maxIterations: 12, // enough for a 5-column board with connectors
  });

  const result = await executor.invoke(
    {
      input: userPrompt,
      boardState: JSON.stringify(boardState, null, 2),
    },
    { signal },
  );

  // Collect tool calls from intermediate steps.
  // Each step.observation is the JSON string our tool func returned.
  const toolCalls: AgentToolCall[] = [];

  for (const step of result.intermediateSteps ?? []) {
    try {
      const parsed = JSON.parse(step.observation as string);
      // Strip the _observation field (that was for the LLM, not the frontend).
      const { _observation, ...call } = parsed;
      toolCalls.push(call as AgentToolCall);
    } catch {
      console.warn(
        '[agent] Skipping unparseable tool observation:',
        step.observation,
      );
    }
  }

  return toolCalls;
}
