/**
 * Cloudflare Worker Entry Point
 *
 * This Worker handles:
 * 1. WebSocket connections (routed to Durable Objects for real-time sync)
 * 2. HTTP REST endpoints (including AI generation in Phase 2)
 * 3. Authentication verification via Clerk JWT
 */

import { BoardRoom } from './durable-objects/BoardRoom';

// Export the Durable Object class
export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  ANTHROPIC_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for frontend communication
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade for real-time board sync
    // Route: /board/:boardId/ws
    if (url.pathname.match(/^\/board\/[\w-]+\/ws$/)) {
      const boardId = url.pathname.split('/')[2];

      // Get the Durable Object for this specific board
      const durableObjectId = env.BOARD_ROOM.idFromName(boardId);
      const durableObject = env.BOARD_ROOM.get(durableObjectId);

      // Forward the WebSocket upgrade request to the Durable Object
      return durableObject.fetch(request);
    }

    // AI Generation endpoint (Phase 2 - prepared but not implemented yet)
    // Route: POST /api/generate
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      return new Response(
        JSON.stringify({
          error: 'AI generation not yet implemented',
          phase: 'Phase 2'
        }),
        {
          status: 501,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Default 404
    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders,
    });
  },
};
