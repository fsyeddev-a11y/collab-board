/**
 * BoardRoom Durable Object
 *
 * Each board gets its own Durable Object instance with:
 * - Embedded SQLite database for persistent state
 * - WebSocket connections for real-time sync
 * - tldraw store sync protocol
 *
 * This runs at the Edge with 0ms cold starts and zero-latency database access.
 */

interface User {
  id: string;
  name: string;
  color: string;
  websocket: WebSocket;
}

export class BoardRoom {
  private state: DurableObjectState;
  private users: Map<string, User>;
  private boardState: Map<string, any>; // Record ID -> Record data

  constructor(state: DurableObjectState) {
    this.state = state;
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

      // Load all records into memory for fast access
      const records = sql.exec(`SELECT id, data FROM board_records`).toArray();

      for (const row of records) {
        const record = JSON.parse(row.data as string);
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
        const message = JSON.parse(event.data as string);
        console.log('[BoardRoom] Received:', message.type, 'from', userId || 'unknown');

        switch (message.type) {
          case 'connect': {
            // Register new user
            if (!message.userId) {
              console.warn('[BoardRoom] Connect message missing userId');
              return;
            }

            const newUserId = message.userId as string;
            userId = newUserId;

            this.users.set(newUserId, {
              id: newUserId,
              name: message.userName,
              color: message.userColor,
              websocket: webSocket,
            });

            console.log(`[BoardRoom] User connected: ${message.userName} (${newUserId})`);
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
              userName: message.userName,
              userColor: message.userColor,
            }, newUserId);
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

            // Apply changes to board state and save to SQLite (non-blocking)
            if (changes.added) {
              for (const [id, record] of Object.entries(changes.added)) {
                this.boardState.set(id, record);
                this.saveRecord(id, record).catch(err =>
                  console.error('[BoardRoom] Error saving added record:', err)
                );
              }
            }

            if (changes.updated) {
              for (const [id, record] of Object.entries(changes.updated)) {
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

          default:
            console.warn('[BoardRoom] Unknown message type:', message.type);
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
