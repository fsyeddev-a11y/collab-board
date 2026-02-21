import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// ── OpenRouter LLM (singleton) ────────────────────────────────────────────────
//
// ChatOpenAI + custom baseURL → OpenRouter's OpenAI-compatible endpoint.
//
// LangSmith tracing activates automatically via env vars:
//   LANGCHAIN_TRACING_V2=true
//   LANGCHAIN_API_KEY=ls__...
//   LANGCHAIN_PROJECT=collabboard

let _llm: ChatOpenAI | null = null;

export function getLLM(): ChatOpenAI {
  if (!_llm) {
    _llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENROUTER_API_KEY,
      modelName: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      temperature: 0.2,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": "https://collabboard.pages.dev",
          "X-Title": "CollabBoard AI Agent",
        },
      },
    });
  }
  return _llm;
}

// ── Tool colour palette (matches tldraw) ──────────────────────────────────────

const TL_COLORS = [
  "yellow",
  "green",
  "blue",
  "orange",
  "red",
  "violet",
  "light-blue",
  "light-green",
  "light-red",
  "light-violet",
  "grey",
  "white",
] as const;

// Map common color names LLMs use to valid tldraw colors
const COLOR_ALIASES: Record<string, (typeof TL_COLORS)[number]> = {
  purple: "violet",
  pink: "light-red",
  cyan: "light-blue",
  lime: "light-green",
  gray: "grey",
  white: "white",
};

const TLColorEnum = z.preprocess((v) => {
  if (typeof v === "string") return COLOR_ALIASES[v.toLowerCase()] ?? v;
  return v;
}, z.enum(TL_COLORS));

// ── Compound Tools ────────────────────────────────────────────────────────────
//
// 4 tools:
//   1. createElements   — ad-hoc element creation (no coordinates)
//   2. updateElements   — batch edits with semantic instructions
//   3. layoutElements   — arrange existing shapes by layout type
//   4. createDiagram    — complex framed templates

export function buildTools() {
  const createElements = new DynamicStructuredTool({
    name: "createElements",
    description:
      "Create one or more elements on the board. The system will automatically " +
      "calculate placement. Use this for ad-hoc creation of sticky notes, shapes, " +
      "text labels, connectors, or empty frames without needing to specify coordinates. " +
      "When the user asks to 'create a frame' (without sections/items), use this tool with type 'frame'.",
    schema: z.object({
      elements: z
        .array(
          z.object({
            type: z
              .enum(["sticky", "shape", "text", "connector", "frame"])
              .describe(
                "sticky: a sticky note; shape: a geometric shape (rectangle); " +
                  "text: a text label; connector: an arrow/line; " +
                  "frame: a container frame for grouping elements",
              ),
            color: TLColorEnum.optional().describe(
              "tldraw colour, or omit for default",
            ),
            text: z
              .string()
              .optional()
              .describe(
                "Text content for the element. For frames, this becomes the frame's display name/title. " +
                "Always pass the user's requested name here (e.g. 'Sprint Planning').",
              ),
          }),
        )
        .min(1)
        .max(30),
    }),
    func: async (input) => {
      const result = { tool: "createElements" as const, ...input };
      return JSON.stringify({
        _observation: `Planned ${input.elements.length} element(s): ${input.elements.map((e) => e.type).join(", ")}. The frontend will handle placement.`,
        ...result,
      });
    },
  });

  const updateElements = new DynamicStructuredTool({
    name: "updateElements",
    description:
      "Batch-edit existing shapes on the board. Find shape IDs from the " +
      "CURRENT BOARD STATE in the system prompt. Each update targets a shape " +
      "by its exact ID and can change text, color, size, or position using " +
      "semantic instructions (no pixel values needed).",
    schema: z.object({
      updates: z
        .array(
          z.object({
            shapeId: z
              .string()
              .describe("The exact tldraw shape ID from the board state"),
            newText: z
              .preprocess(
                (v) => (v === "" ? undefined : v),
                z.string().optional(),
              )
              .describe(
                "New text content for the shape, or omit to leave unchanged",
              ),
            newName: z
              .preprocess(
                (v) => (v === "" ? undefined : v),
                z.string().optional(),
              )
              .describe(
                "New display name for frame elements (rename a frame). Only applies to frames. Omit to leave unchanged",
              ),
            newColor: z
              .preprocess(
                (v) => (v === "" ? undefined : v),
                TLColorEnum.optional(),
              )
              .describe("New tldraw colour, or omit to leave unchanged"),
            resizeInstruction: z
              .preprocess(
                (v) => (v === "" ? undefined : v),
                z.enum(["double", "half", "fit-to-content"]).optional(),
              )
              .describe(
                "How to resize: double, half, or fit-to-content. Omit to leave unchanged",
              ),
            moveInstruction: z
              .preprocess(
                (v) => (v === "" ? undefined : v),
                z
                  .enum(["left", "right", "up", "down", "closer-together"])
                  .optional(),
              )
              .describe("Direction to move the shape. Omit to leave unchanged"),
          }),
        )
        .min(1),
    }),
    func: async (input) => {
      const result = { tool: "updateElements" as const, ...input };
      return JSON.stringify({
        _observation: `Planned ${input.updates.length} element update(s): ${input.updates.map((u) => u.shapeId).join(", ")}.`,
        ...result,
      });
    },
  });

  const layoutElements = new DynamicStructuredTool({
    name: "layoutElements",
    description:
      "Arrange existing shapes into a layout pattern. Find shape IDs from the " +
      "CURRENT BOARD STATE. The system will reposition the shapes into the " +
      "requested layout automatically.",
    schema: z.object({
      shapeIds: z
        .array(z.string())
        .min(2)
        .describe("The exact tldraw shape IDs to arrange"),
      layoutType: z
        .enum(["grid", "horizontal-row", "vertical-column", "even-spacing"])
        .describe(
          "grid: arrange in rows/cols; horizontal-row: single row left-to-right; " +
            "vertical-column: single column top-to-bottom; even-spacing: spread evenly",
        ),
    }),
    func: async (input) => {
      const result = { tool: "layoutElements" as const, ...input };
      return JSON.stringify({
        _observation: `Planned ${input.layoutType} layout for ${input.shapeIds.length} shapes.`,
        ...result,
      });
    },
  });

  const createDiagram = new DynamicStructuredTool({
    name: "createDiagram",
    description:
      "Create a structured diagram with frames and sticky notes. The system " +
      "will automatically calculate all coordinates, frame sizes, and element " +
      "placement. You only need to provide the content structure. Use this for " +
      "SWOT analyses, kanban boards, user journeys, retrospectives, or any " +
      "custom framed layout.",
    schema: z.object({
      diagramType: z
        .enum([
          "swot",
          "kanban",
          "user_journey",
          "retrospective",
          "custom_frame",
        ])
        .describe(
          "swot: 2x2 grid (Strengths, Weaknesses, Opportunities, Threats); " +
            "kanban: horizontal columns (e.g. To Do, In Progress, Done); " +
            "user_journey: horizontal flow of stages with touchpoints; " +
            "retrospective: columns for What Went Well, What Didn't, Action Items; " +
            "custom_frame: flexible columns for any other framed layout",
        ),
      title: z.string().describe("The title of the overall diagram"),
      sections: z
        .array(
          z.object({
            sectionTitle: z.string().describe("Header for this section/column"),
            items: z
              .array(z.string())
              .describe("Sticky note contents for this section"),
          }),
        )
        .min(1)
        .max(10),
    }),
    func: async (input) => {
      const result = { tool: "createDiagram" as const, ...input };
      const totalItems = input.sections.reduce(
        (sum, s) => sum + s.items.length,
        0,
      );
      return JSON.stringify({
        _observation: `Planned ${input.diagramType} diagram "${input.title}" with ${input.sections.length} sections and ${totalItems} items. The frontend will handle all layout geometry.`,
        ...result,
      });
    },
  });

  return [createElements, updateElements, layoutElements, createDiagram];
}

// ── Spatial system prompt ─────────────────────────────────────────────────────
//
// Board state is injected as a {boardState} template variable — NOT inlined
// directly — because JSON braces would break LangChain's f-string parser.

const SYSTEM_PROMPT = `You are an expert architecture assistant for a 2D whiteboard.

YOUR CAPABILITIES:
1. You do not calculate X/Y coordinates. You output intent, and the system executes the math.
2. To edit or layout existing shapes, you MUST look at the CURRENT BOARD STATE below. Find the exact 'id' of the shape the user wants to change, and pass it to the 'updateElements' or 'layoutElements' tool.
3. DO NOT hallucinate shape IDs. Match them exactly from the state.

AVAILABLE TOOLS:
- **createElements**: Create ad-hoc elements (sticky notes, shapes, text, connectors, empty frames). No coordinates needed. Use type 'frame' for standalone frames.
- **updateElements**: Edit existing shapes by ID — change text, color, resize (double/half/fit-to-content), or move (left/right/up/down/closer-together).
- **layoutElements**: Arrange existing shapes by ID into a grid, row, column, or even spacing.
- **createDiagram**: Create structured framed layouts (SWOT, kanban, user journey, retrospective, custom frames) with sections and items.

SELECTION CONTEXT:
- Each shape has an 'isSelected' flag and 'parentId' field in the board state.
- When the user says "these", "selected", or refers to specific elements without naming IDs,
  use the shapes where isSelected is true.
- 'parentId' starting with 'shape:' means the element is inside a frame.
  'parentId' starting with 'page:' means it is a top-level element.
- When arranging or moving elements, only operate on the selected shapes unless the user
  explicitly asks to move all shapes.

RULES:
1. Always use tools. Never return plain text as your final answer.
2. For quick ad-hoc elements (including empty frames), use createElements.
3. For structured layouts with frames AND sticky notes inside them, use createDiagram.
4. For editing existing shapes, use updateElements with exact shape IDs from the board state.
5. For rearranging existing shapes, use layoutElements with exact shape IDs.
6. Generate 3-6 realistic starter items per section when brainstorming.
7. Use varied colours for visual distinction.
8. Move instructions (left/right/up/down) shift shapes by a moderate distance.
   For large repositioning, use layoutElements to rearrange shapes instead.
9. To rename a frame, use updateElements with newName (not newText). newText changes
   the text content of notes/shapes; newName changes the display title of frames.

MULTI-STEP COMMANDS:
- When a prompt contains multiple intents (e.g. rename + recolor + create), handle them
  as separate sequential tool calls — one per intent.
- Batch related edits into a single updateElements call (e.g. rename all frames in one call,
  recolor all notes in another).
- Do NOT duplicate shape IDs across calls unless a later step depends on a prior change.

CURRENT BOARD STATE:
{boardState}`;

// ── Public interface ──────────────────────────────────────────────────────────

export interface AgentToolCall {
  tool: string;
  [key: string]: unknown;
}

export async function runAgent(
  userPrompt: string,
  boardState: unknown[],
  signal?: AbortSignal,
): Promise<AgentToolCall[]> {
  const tools = buildTools();
  const llm = getLLM();

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT],
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  const agent = createToolCallingAgent({ llm, tools, prompt });

  const executor = new AgentExecutor({
    agent,
    tools,
    returnIntermediateSteps: true,
    maxIterations: 8,
  });

  const result = await executor.invoke(
    {
      input: userPrompt,
      boardState: JSON.stringify(boardState, null, 2),
    },
    { signal },
  );

  // Collect tool calls from intermediate steps.
  const toolCalls: AgentToolCall[] = [];

  for (const step of result.intermediateSteps ?? []) {
    try {
      const parsed = JSON.parse(step.observation as string);
      const { _observation, ...call } = parsed;
      toolCalls.push(call as AgentToolCall);
    } catch {
      console.warn(
        "[agent] Skipping unparseable tool observation:",
        step.observation,
      );
    }
  }

  return toolCalls;
}
