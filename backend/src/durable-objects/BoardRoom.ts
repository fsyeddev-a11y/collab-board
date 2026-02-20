/**
 * BoardRoom Durable Object
 *
 * Each board gets its own Durable Object instance with:
 * - Embedded SQLite database for persistent state
 * - WebSocket connections for real-time sync
 * - tldraw store sync protocol
 * - JWT authentication via Clerk
 *
 * This runs at the Edge with 0ms cold starts and zero-latency database access.
 */

// verifyToken is imported dynamically inside the connect handler so that
// @clerk/backend (and its transitive deps) are only loaded when a real
// WebSocket authentication is needed.  This keeps cold-start cost low and
// prevents CJS/ESM interop issues in the vitest-pool-workers test environment.

import { ClientWSMessageSchema } from '@collabboard/shared';

interface User {
  id: string;
  name: string;
  color: string;
  websocket: WebSocket;
}

interface Env {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
}

export class BoardRoom {
  private state: DurableObjectState;
  private env: Env;
  private users: Map<string, User>;
  private boardState: Map<string, any>; // Record ID -> Record data

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.users = new Map();
    this.boardState = new Map();

    // Block concurrent executions to prevent race conditions
    state.blockConcurrencyWhile(async () => {
      await this.loadBoardState();
    });
  }

  async fetch(request: Request): Promise<Response> {
    // Upgrade to WebSocket
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Accept the WebSocket connection
      await this.handleSession(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // Non-WebSocket requests
    return new Response('Expected WebSocket', { status: 400 });
  }

  /**
   * Load board state from SQLite on initialization
   */
  private async loadBoardState(): Promise<void> {
    try {
      const sql = this.state.storage.sql;

      // Create table if it doesn't exist
      sql.exec(`
        CREATE TABLE IF NOT EXISTS board_records (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // One-time cleanup: remove any instance_presence records that were
      // incorrectly persisted before this fix was applied.
      sql.exec(`DELETE FROM board_records WHERE type = 'instance_presence'`);

      // Load all records into memory for fast access.
      // instance_presence records are ephemeral and must never be loaded into
      // boardState — doing so would send stale ghost-cursors to new joiners.
      const records = sql.exec(`SELECT id, data FROM board_records`).toArray();

      for (const row of records) {
        const record = JSON.parse(row.data as string);
        if (record.typeName === 'instance_presence') continue;
        this.boardState.set(row.id as string, record);
      }

      console.log(`[BoardRoom] Loaded ${this.boardState.size} records from SQLite`);
    } catch (error) {
      console.error('[BoardRoom] Error loading board state:', error);
    }
  }

  /**
   * Save a record to SQLite
   */
  private async saveRecord(id: string, record: any): Promise<void> {
    try {
      const sql = this.state.storage.sql;
      const data = JSON.stringify(record);
      const now = Date.now();

      sql.exec(
        `INSERT OR REPLACE INTO board_records (id, type, data, updated_at) VALUES (?, ?, ?, ?)`,
        id,
        record.typeName || 'unknown',
        data,
        now
      );
    } catch (error) {
      console.error('[BoardRoom] Error saving record:', error);
    }
  }

  /**
   * Delete a record from SQLite
   */
  private async deleteRecord(id: string): Promise<void> {
    try {
      const sql = this.state.storage.sql;
      sql.exec(`DELETE FROM board_records WHERE id = ?`, id);
    } catch (error) {
      console.error('[BoardRoom] Error deleting record:', error);
    }
  }

  /**
   * Handle a new WebSocket session
   */
  async handleSession(webSocket: WebSocket): Promise<void> {
    // Accept the WebSocket
    webSocket.accept();

    let userId: string | null = null;

    // Handle incoming messages
    webSocket.addEventListener('message', async (event) => {
      try {
        // ── Step 1: parse JSON ────────────────────────────────────────────────
        let rawMessage: unknown;
        try {
          rawMessage = JSON.parse(event.data as string);
        } catch {
          webSocket.send(JSON.stringify({
            type: 'error',
            message: 'Invalid JSON',
            error: 'Message could not be parsed as JSON',
          }));
          return;
        }

        // ── Step 2: validate against the shared Zod schema ───────────────────
        // This enforces the contract for every message type before any handler
        // logic runs.  Unknown / malformed messages are rejected immediately.
        const parseResult = ClientWSMessageSchema.safeParse(rawMessage);
        if (!parseResult.success) {
          console.warn('[BoardRoom] Invalid message schema:', parseResult.error.flatten());
          webSocket.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
            error: parseResult.error.message,
          }));
          return;
        }

        const message = parseResult.data;
        console.log('[BoardRoom] Received:', message.type, 'from', userId || 'unknown');

        switch (message.type) {
          case 'connect': {
            // Verify JWT token before accepting connection
            if (!message.token) {
              console.error('[BoardRoom] Connect message missing JWT token');
              webSocket.send(JSON.stringify({
                type: 'error',
                message: 'Authentication required',
                error: 'Missing JWT token',
              }));
              webSocket.close(1008, 'Authentication required');
              return;
            }

            try {
              // Dynamic import: only loaded when a real connect is authenticated.
              const { verifyToken } = await import('@clerk/backend');
              const verifiedToken = await verifyToken(message.token, {
                secretKey: this.env.CLERK_SECRET_KEY,
                clockSkewInMs: 5000, // Allow 5 seconds clock skew tolerance
              });

              console.log('[BoardRoom] JWT verified for user:', verifiedToken.sub);

              // Extract user info from verified JWT claims
              const newUserId = verifiedToken.sub; // Clerk user ID
              const userName = message.userName; // Use name from message (already from Clerk frontend)
              userId = newUserId;

              this.users.set(newUserId, {
                id: newUserId,
                name: userName,
                color: message.userColor,
                websocket: webSocket,
              });

              console.log(`[BoardRoom] User connected: ${userName} (${newUserId})`);
              console.log(`[BoardRoom] Total users: ${this.users.size}`);

              // Send initial state to the new user
              const records = Array.from(this.boardState.values());
              webSocket.send(JSON.stringify({
                type: 'init',
                records: records,
                users: Array.from(this.users.values()).map(u => ({
                  id: u.id,
                  name: u.name,
                  color: u.color,
                })),
              }));

              // Notify other users about the new connection
              this.broadcast({
                type: 'user-joined',
                userId: newUserId,
                userName: userName,
                userColor: message.userColor,
              }, newUserId);
            } catch (error: any) {
              console.error('[BoardRoom] JWT verification failed:', error);

              // Check if token is expired
              const isExpired = error?.reason === 'token-expired' || error?.message?.includes('expired');

              webSocket.send(JSON.stringify({
                type: 'error',
                message: isExpired ? 'Token expired - please reconnect' : 'Authentication failed',
                error: String(error),
                shouldRetry: isExpired, // Frontend can use this to auto-retry
              }));

              webSocket.close(1008, isExpired ? 'Token expired' : 'Invalid authentication token');
              return;
            }
            break;
          }

          case 'disconnect':
            // User is disconnecting
            if (userId) {
              this.users.delete(userId);
              console.log(`[BoardRoom] User disconnected: ${userId}`);
              console.log(`[BoardRoom] Total users: ${this.users.size}`);

              // Notify other users
              this.broadcast({
                type: 'user-left',
                userId: userId,
              }, userId);
            }
            break;

          case 'cursor': {
            // Handle cursor position updates
            if (!userId) {
              console.warn('[BoardRoom] Received cursor update from unregistered user');
              return;
            }

            // Always use the server-verified identity stored at connect time.
            // The client-supplied userId/userName/userColor fields in the cursor
            // message payload are intentionally ignored — a client cannot spoof
            // another user's identity by crafting those fields.
            const cursorUser = this.users.get(userId);
            this.broadcast({
              type: 'cursor',
              userId: userId,
              userName: cursorUser?.name ?? '',
              userColor: cursorUser?.color ?? '',
              x: message.x,
              y: message.y,
            }, userId);
            break;
          }

          case 'update': {
            // Handle tldraw store updates
            if (!userId) {
              console.warn('[BoardRoom] Received update from unregistered user');
              return;
            }

            const currentUserId = userId as string;
            const { changes } = message;

            console.log('[BoardRoom] Processing update:', {
              added: Object.keys(changes.added || {}).length,
              updated: Object.keys(changes.updated || {}).length,
              removed: Object.keys(changes.removed || {}).length,
            });

            // Apply changes to board state and persist to SQLite.
            //
            // instance_presence records are tldraw's ephemeral per-user cursor
            // and selection state.  They must NOT be written to boardState or
            // SQLite — persisting them causes new joiners to receive stale
            // ghost-cursors for users who are long gone.  They are still
            // included in the broadcast below so live peers see real-time
            // selection highlights.
            if (changes.added) {
              for (const [id, record] of Object.entries(changes.added)) {
                if (record.typeName === 'instance_presence') continue;
                this.boardState.set(id, record);
                this.saveRecord(id, record).catch(err =>
                  console.error('[BoardRoom] Error saving added record:', err)
                );
              }
            }

            if (changes.updated) {
              for (const [id, record] of Object.entries(changes.updated)) {
                if (record.typeName === 'instance_presence') continue;
                this.boardState.set(id, record);
                this.saveRecord(id, record).catch(err =>
                  console.error('[BoardRoom] Error saving updated record:', err)
                );
              }
            }

            if (changes.removed) {
              for (const id of Object.keys(changes.removed)) {
                this.boardState.delete(id);
                this.deleteRecord(id).catch(err =>
                  console.error('[BoardRoom] Error deleting record:', err)
                );
              }
            }

            // Broadcast to all other users
            this.broadcast({
              type: 'update',
              userId: currentUserId,
              changes: changes,
            }, currentUserId);

            console.log(`[BoardRoom] Applied update from ${currentUserId}. Board size: ${this.boardState.size}`);
            break;
          }

        }
      } catch (error) {
        console.error('[BoardRoom] Error handling message:', error);
        // Send error back to client but don't close connection
        try {
          webSocket.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process message',
            error: String(error),
          }));
        } catch (sendError) {
          console.error('[BoardRoom] Error sending error message:', sendError);
        }
      }
    });

    // Handle connection close
    webSocket.addEventListener('close', () => {
      if (userId) {
        this.users.delete(userId);
        console.log(`[BoardRoom] WebSocket closed for user: ${userId}`);
        console.log(`[BoardRoom] Total users: ${this.users.size}`);

        // Notify other users
        this.broadcast({
          type: 'user-left',
          userId: userId,
        }, userId);
      }
    });

    // Handle errors
    webSocket.addEventListener('error', (error) => {
      console.error('[BoardRoom] WebSocket error:', error);
      if (userId) {
        this.users.delete(userId);
      }
    });
  }


  /**
   * Broadcast message to all connected users except sender
   */
  private broadcast(message: any, excludeUserId?: string): void {
    const messageStr = JSON.stringify(message);

    for (const [id, user] of this.users.entries()) {
      if (id !== excludeUserId) {
        try {
          if (user.websocket.readyState === WebSocket.OPEN) {
            user.websocket.send(messageStr);
          }
        } catch (error) {
          console.error(`[BoardRoom] Error broadcasting to user ${id}:`, error);
          this.users.delete(id);
        }
      }
    }
  }
}
