import { z } from 'zod';
import { ShapeSchema } from './shapes';

/**
 * Zod schemas for API requests and responses
 * Used for communication between frontend and Cloudflare Worker backend
 */

// AI Generation Request (Phase 2 - prepared but not implemented yet)
export const AIGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(1000),
  boardId: z.string(),
  contextShapes: z.array(ShapeSchema).optional(),
});

export type AIGenerationRequest = z.infer<typeof AIGenerationRequestSchema>;

// AI Generation Response (Phase 2 - prepared but not implemented yet)
export const AIGenerationResponseSchema = z.object({
  shapes: z.array(ShapeSchema),
  message: z.string().optional(),
});

export type AIGenerationResponse = z.infer<typeof AIGenerationResponseSchema>;

// WebSocket Message Types
export const WSMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('connect'),
    userId: z.string(),
    userName: z.string(),
  }),
  z.object({
    type: z.literal('disconnect'),
    userId: z.string(),
  }),
  z.object({
    type: z.literal('cursor'),
    userId: z.string(),
    userName: z.string(),
    userColor: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal('shape-create'),
    shape: ShapeSchema,
  }),
  z.object({
    type: z.literal('shape-update'),
    shapeId: z.string(),
    changes: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('shape-delete'),
    shapeId: z.string(),
  }),
]);

export type WSMessage = z.infer<typeof WSMessageSchema>;

// Board state
export const BoardStateSchema = z.object({
  id: z.string(),
  shapes: z.array(ShapeSchema),
  users: z.array(z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
  })),
});

export type BoardState = z.infer<typeof BoardStateSchema>;
