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

// A tldraw record as transmitted over WebSocket.
// Uses passthrough() to allow arbitrary shape-specific fields beyond id and typeName.
export const TLRecordSchema = z.object({
  id: z.string(),
  typeName: z.string(),
}).passthrough();

export type TLRecordPayload = z.infer<typeof TLRecordSchema>;

// The tldraw diff payload sent in 'update' messages.
// Note: 'updated' contains only the new value (not the [before, after] tuple tldraw uses
// internally) because the frontend extracts update[1] before sending over the wire.
export const TLChangesSchema = z.object({
  added: z.record(z.string(), TLRecordSchema).default({}),
  updated: z.record(z.string(), TLRecordSchema).default({}),
  removed: z.record(z.string(), TLRecordSchema).default({}),
});

export type TLChanges = z.infer<typeof TLChangesSchema>;

// Client → Server WebSocket messages
export const ClientWSMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('connect'),
    userId: z.string(),
    userName: z.string(),
    userColor: z.string(),
    token: z.string(),
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
    type: z.literal('update'),
    userId: z.string(),
    changes: TLChangesSchema,
  }),
]);

export type ClientWSMessage = z.infer<typeof ClientWSMessageSchema>;

// Server → Client WebSocket messages
export const ServerWSMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    records: z.array(TLRecordSchema),
    users: z.array(z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
    })),
  }),
  z.object({
    type: z.literal('update'),
    userId: z.string(),
    changes: TLChangesSchema,
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
    type: z.literal('user-joined'),
    userId: z.string(),
    userName: z.string(),
    userColor: z.string(),
  }),
  z.object({
    type: z.literal('user-left'),
    userId: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    error: z.string(),
    shouldRetry: z.boolean().optional(),
  }),
]);

export type ServerWSMessage = z.infer<typeof ServerWSMessageSchema>;

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
