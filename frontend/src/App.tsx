import { useEffect, useState, useRef } from 'react';
import { Tldraw, InstancePresenceRecordType } from 'tldraw';
import type { Editor, TLRecord, TLStoreEventInfo } from '@tldraw/editor';
import { useUser, useAuth, SignIn, UserButton } from '@clerk/clerk-react';
import { shouldSendCursor, CURSOR_THROTTLE_MS } from './utils/cursorThrottle';
import { patchNoteCloneHandle } from './utils/noteArrowOverride';
import 'tldraw/tldraw.css';

// User color palette for presence
const USER_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];

// Helper to get consistent color for a user ID
function getUserColor(userId: string): string {
  // Use user ID hash to consistently assign a color
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return USER_COLORS[hash % USER_COLORS.length];
}


interface ConnectedUser {
  id: string;
  name: string;
  color: string;
}

function App() {
  // Clerk authentication hooks - MUST be called unconditionally
  const { isSignedIn, user, isLoaded } = useUser();
  const { getToken } = useAuth();

  // All other hooks - MUST be called unconditionally
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'failed'>('connecting');
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
  const [isPresenceExpanded, setIsPresenceExpanded] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isRemoteChangeRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Maximum users to show before showing "+X more"
  const MAX_VISIBLE_USERS = 5;
  const MAX_RECONNECT_DELAY = 5000;
  const MAX_RECONNECT_ATTEMPTS = 5;

  // Stable ref to the latest connectWebSocket function. The function itself
  // lives inside useEffect to avoid stale closures over USER_ID / getToken.
  // The button and any other non-effect code use this ref to trigger a reconnect.
  const connectRef = useRef<(() => Promise<void>) | null>(null);

  // Get authenticated user info (only when signed in)
  const USER_ID = isSignedIn && user ? user.id : '';
  const USER_NAME = isSignedIn && user ? (user.fullName || user.username || user.emailAddresses[0]?.emailAddress || 'Anonymous') : '';
  const USER_COLOR = USER_ID ? getUserColor(USER_ID) : '#666';

  // Connect to WebSocket when authenticated.
  //
  // connectWebSocket is defined INSIDE useEffect so every reconnect attempt
  // always closes over the correct USER_ID / USER_NAME / USER_COLOR / getToken
  // values from the moment the effect ran. Defining it outside would capture
  // stale values if Clerk updated user info between reconnect attempts.
  useEffect(() => {
    if (!isSignedIn || !USER_ID) return;

    // ── StrictMode safety via the `destroyed` flag ────────────────────────
    // React StrictMode mounts → unmounts → remounts every effect in development.
    // `destroyed` is set to true in the cleanup function BEFORE socket.close()
    // is called.  Because WebSocket's onclose fires asynchronously, it will
    // always see `destroyed === true` by the time it runs and will never
    // schedule a reconnect for the dead first-mount.  This prevents a stale
    // socket from racing against the second mount's fresh connection.
    let destroyed = false;

    const connectWebSocket = async () => {
      if (destroyed) return;

      // Close any leftover socket before opening a new one
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) { /* ignore */ }
        wsRef.current = null;
      }

      // Always fetch a fresh JWT — avoids sending an expired token on reconnects
      let token: string | null = null;
      try {
        token = await getToken({ skipCache: true });
        if (!token) { setConnectionStatus('disconnected'); return; }
      } catch (_) {
        setConnectionStatus('disconnected'); return;
      }

      // The effect may have been cleaned up while we were awaiting the token
      if (destroyed) return;

      const boardId = 'default-board';
      const wsUrl = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8787';
      const websocket = new WebSocket(`${wsUrl}/board/${boardId}/ws`);
      wsRef.current = websocket;
      setConnectionStatus('connecting');

      websocket.onopen = () => {
        if (destroyed) { websocket.close(); return; }
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0; // Reset on every successful open
        websocket.send(JSON.stringify({
          type: 'connect',
          userId: USER_ID,
          userName: USER_NAME,
          userColor: USER_COLOR,
          token,
        }));
      };

      websocket.onclose = () => {
        // Ignore if this effect instance was already cleaned up, or if a newer
        // socket has taken over wsRef (e.g. a manual reconnect fired first).
        if (destroyed || wsRef.current !== websocket) return;

        setConnectionStatus('disconnected');
        if (reconnectTimeoutRef.current !== null) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        // ── Exponential backoff with a hard attempt cap ───────────────────
        // Increment BEFORE the limit check.  The manual "Reconnect" button
        // resets the counter to 0, which restarts the full 5-attempt window.
        reconnectAttemptsRef.current += 1;

        if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
          console.warn(`[WS] Giving up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts.`);
          setConnectionStatus('failed');
          return;
        }

        // Delay schedule: 1s → 2s → 4s → 5s (cap) → 5s
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttemptsRef.current - 1),
          MAX_RECONNECT_DELAY,
        );
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);

        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (!destroyed) connectWebSocket();
        }, delay);
      };

      websocket.onerror = () => {
        if (!destroyed) setConnectionStatus('disconnected');
      };

      websocket.onmessage = (event) => {
        if (destroyed) return;
        try {
          const message = JSON.parse(event.data);
          const editor = editorRef.current;
          if (!editor) return;

          // ── error ────────────────────────────────────────────────────────
          if (message.type === 'error') {
            console.error('[WS] Server error:', message.message, message.error);
            // shouldRetry === false is a permanent failure signal from the
            // backend (e.g. a revoked Clerk token). Cancel pending retries
            // and surface the failure state to the user immediately.
            if (message.shouldRetry === false) {
              if (reconnectTimeoutRef.current !== null) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
              }
              setConnectionStatus('failed');
            }
            return;
          }

          // ── init ─────────────────────────────────────────────────────────
          if (message.type === 'init' && message.records) {
            console.log('[WS] Loading initial records:', message.records.length);
            if (message.records.length > 0) {
              isRemoteChangeRef.current = true;
              editor.store.mergeRemoteChanges(() => {
                try {
                  // Separate records by type — load shapes before bindings
                  // to prevent arrow binding errors when the bound shape
                  // does not exist yet.
                  const shapes: TLRecord[] = [];
                  const bindings: TLRecord[] = [];
                  const others: TLRecord[] = [];

                  message.records.forEach((record: TLRecord) => {
                    if (!record || !record.id || !record.typeName) {
                      console.warn('[WS] Skipping invalid initial record:', record);
                      return;
                    }
                    if (record.typeName === 'binding') bindings.push(record);
                    else if (record.typeName === 'shape') shapes.push(record);
                    else others.push(record);
                  });

                  others.forEach((r) => editor.store.put([r]));
                  shapes.forEach((r) => editor.store.put([r]));
                  bindings.forEach((r) => editor.store.put([r]));
                } catch (error) {
                  console.error('[WS] Error loading initial records:', error);
                } finally {
                  // Reset INSIDE the callback via finally so the flag only
                  // clears after tldraw has fully processed every record in
                  // the batch. Resetting outside risks a local-change listener
                  // firing in the gap and echoing the update back to the server.
                  isRemoteChangeRef.current = false;
                }
              });
            }
            if (message.users) setConnectedUsers(message.users);

          // ── update ───────────────────────────────────────────────────────
          } else if (message.type === 'update' && message.changes) {
            console.log('[WS] Applying remote changes');
            isRemoteChangeRef.current = true;
            editor.store.mergeRemoteChanges(() => {
              try {
                if (message.changes.added) {
                  const shapes: TLRecord[] = [];
                  const bindings: TLRecord[] = [];
                  const others: TLRecord[] = [];

                  (Object.values(message.changes.added) as TLRecord[]).forEach((record) => {
                    if (!record || !record.id || !record.typeName) {
                      console.warn('[WS] Skipping invalid added record:', record);
                      return;
                    }
                    if (record.typeName === 'binding') bindings.push(record);
                    else if (record.typeName === 'shape') shapes.push(record);
                    else others.push(record);
                  });

                  others.forEach((r) => editor.store.put([r]));
                  shapes.forEach((r) => editor.store.put([r]));
                  bindings.forEach((r) => editor.store.put([r]));
                }

                if (message.changes.updated) {
                  (Object.values(message.changes.updated) as TLRecord[]).forEach((record) => {
                    if (record && record.id && record.typeName) editor.store.put([record]);
                    else console.warn('[WS] Skipping invalid updated record:', record);
                  });
                }

                if (message.changes.removed) {
                  Object.keys(message.changes.removed).forEach((id: string) => {
                    if (id) editor.store.remove([id as TLRecord['id']]);
                  });
                }
              } catch (error) {
                console.error('[WS] Error applying remote changes:', error);
              } finally {
                isRemoteChangeRef.current = false;
              }
            });

          // ── cursor ───────────────────────────────────────────────────────
          } else if (message.type === 'cursor') {
            const { userId, userName, userColor, x, y } = message;
            if (userId === USER_ID) return;

            const presenceId = InstancePresenceRecordType.createId(userId);
            const currentPageId = editor.getCurrentPageId();
            const presence = {
              id: presenceId,
              typeName: 'instance_presence' as const,
              userId,
              userName,
              currentPageId,
              cursor: { x, y, type: 'default' as const, rotation: 0 },
              color: userColor,
              camera: { x: 0, y: 0, z: 1 },
              selectedShapeIds: [],
              brush: null,
              scribbles: [],
              screenBounds: { x: 0, y: 0, w: 1920, h: 1080 },
              followingUserId: null,
              meta: {},
              chatMessage: '',
              lastActivityTimestamp: Date.now(),
            };

            isRemoteChangeRef.current = true;
            editor.store.mergeRemoteChanges(() => {
              try {
                editor.store.put([presence]);
              } finally {
                isRemoteChangeRef.current = false;
              }
            });

          // ── user-joined ──────────────────────────────────────────────────
          } else if (message.type === 'user-joined') {
            setConnectedUsers(prev => [...prev, {
              id: message.userId,
              name: message.userName,
              color: message.userColor,
            }]);

            // Broadcast our current cursor position so the new user sees us
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
              try {
                const currentPagePoint = editor.inputs.currentPagePoint;
                ws.send(JSON.stringify({
                  type: 'cursor',
                  userId: USER_ID,
                  userName: USER_NAME,
                  userColor: USER_COLOR,
                  x: currentPagePoint.x,
                  y: currentPagePoint.y,
                }));
              } catch (error) {
                console.error('[WS] Error sending cursor on user-joined:', error);
              }
            }

          // ── user-left ────────────────────────────────────────────────────
          } else if (message.type === 'user-left') {
            const presenceId = InstancePresenceRecordType.createId(message.userId);
            isRemoteChangeRef.current = true;
            editor.store.mergeRemoteChanges(() => {
              try {
                editor.store.remove([presenceId]);
              } finally {
                isRemoteChangeRef.current = false;
              }
            });
            setConnectedUsers(prev => prev.filter(u => u.id !== message.userId));
          }
        } catch (error) {
          console.error('[WS] Error parsing message:', error);
        }
      };
    };

    connectRef.current = connectWebSocket;
    connectWebSocket();

    return () => {
      // ── Cleanup: mark this effect instance as dead ────────────────────
      // `destroyed = true` is set BEFORE socket.close() is called.
      // WebSocket's onclose fires asynchronously, so by the time it runs,
      // `destroyed` is already true and no reconnect will be scheduled.
      //
      // This is the key to React StrictMode correctness: the first mount's
      // onclose (which fires after cleanup closes the socket) can never race
      // against the second mount's fresh socket, because `destroyed` stops it
      // dead before it can call setConnectionStatus or schedule a timeout.
      destroyed = true;
      connectRef.current = null;

      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      const ws = wsRef.current;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'disconnect', userId: USER_ID }));
        }
        ws.close();
        wsRef.current = null;
      }
    };
  }, [isSignedIn, USER_ID]); // eslint-disable-line react-hooks/exhaustive-deps
  // USER_NAME / USER_COLOR / getToken intentionally omitted: they are stable
  // within a session (USER_ID change triggers a full reconnect already) and
  // including them would cause unnecessary reconnects on minor Clerk updates.

  // Set up editor listener when editor is ready
  const handleEditorMount = (editor: Editor) => {
    // Safety check - should never happen but guard against it
    if (!isSignedIn || !USER_ID) {
      console.error('[Tldraw] Editor mount attempted without authentication!');
      return;
    }

    console.log('[Tldraw] Editor mounted');
    editorRef.current = editor;

    // Override note clone-handle behaviour: create an arrow instead of a new note.
    patchNoteCloneHandle(editor);

    // Set user preferences
    editor.user.updateUserPreferences({
      id: USER_ID,
      name: USER_NAME,
      color: USER_COLOR,
    });

    // Listen to local changes and send to server
    const handleChange = (event: TLStoreEventInfo) => {
      // Skip remote changes to prevent loops
      if (isRemoteChangeRef.current) return;

      const { changes, source } = event;

      // Only send changes from user interactions
      if (source === 'user') {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.warn('[WS] Cannot send update - WebSocket not ready');
          return;
        }

        try {
          const update = {
            type: 'update',
            userId: USER_ID,
            changes: {
              added: Object.fromEntries(
                Object.entries(changes.added).map(([id, record]) => [id, record])
              ),
              updated: Object.fromEntries(
                Object.entries(changes.updated).map(([id, [, to]]) => [id, to])
              ),
              removed: Object.fromEntries(
                Object.entries(changes.removed).map(([id, record]) => [id, record])
              ),
            },
          };

          console.log('[WS] Sending update:', update);
          ws.send(JSON.stringify(update));
        } catch (error) {
          console.error('[WS] Error sending update:', error);
        }
      }
    };

    // Subscribe to store changes
    const unsubscribe = editor.store.listen(handleChange, { source: 'user', scope: 'document' });

    // Track and broadcast cursor movements using polling
    let lastCursorUpdate = 0;
    let lastCursorX = 0;
    let lastCursorY = 0;

    const cursorInterval = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      try {
        const currentPagePoint = editor.inputs.currentPagePoint;
        const x = currentPagePoint.x;
        const y = currentPagePoint.y;
        const now = Date.now();

        if (shouldSendCursor(x, y, lastCursorX, lastCursorY, lastCursorUpdate, now)) {
          ws.send(JSON.stringify({
            type: 'cursor',
            userId: USER_ID,
            userName: USER_NAME,
            userColor: USER_COLOR,
            x,
            y,
          }));
          lastCursorUpdate = now;
          lastCursorX = x;
          lastCursorY = y;
        }
      } catch (error) {
        console.error('[WS] Error sending cursor update:', error);
      }
    }, CURSOR_THROTTLE_MS);

    // Clean up listener when component unmounts
    return () => {
      console.log('[Tldraw] Cleaning up editor listener');
      unsubscribe();
      clearInterval(cursorInterval);
    };
  };

  // Show loading state while Clerk is initializing
  if (!isLoaded) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#f5f5f5'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', color: '#666' }}>Loading...</div>
        </div>
      </div>
    );
  }

  // Show sign-in UI for unauthenticated users
  if (!isSignedIn || !user) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#f5f5f5'
      }}>
        <SignIn routing="hash" />
      </div>
    );
  }

  // Main app UI for authenticated users
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Connection status bar */}
      <div
        style={{
          padding: '8px 16px',
          background: connectionStatus === 'connected' ? '#10b981' : connectionStatus === 'connecting' ? '#f59e0b' : '#ef4444',
          color: 'white',
          fontSize: '14px',
          fontWeight: '500',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        {/* Connection status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'white',
              animation: connectionStatus === 'connecting' ? 'pulse 2s infinite' : 'none',
            }}
          />
          <span>
            {connectionStatus === 'connected' && `Connected as ${USER_NAME}`}
            {connectionStatus === 'connecting' && 'Connecting to board...'}
            {connectionStatus === 'disconnected' && 'Disconnected — reconnecting...'}
            {connectionStatus === 'failed' && 'Connection failed — click Reconnect to try again'}
          </span>
          {(connectionStatus === 'disconnected' || connectionStatus === 'failed') && (
            <button
              onClick={() => {
                if (reconnectTimeoutRef.current !== null) {
                  clearTimeout(reconnectTimeoutRef.current);
                  reconnectTimeoutRef.current = null;
                }
                reconnectAttemptsRef.current = 0;
                connectRef.current?.();
              }}
              style={{
                padding: '4px 12px',
                background: 'rgba(255, 255, 255, 0.2)',
                border: '1px solid white',
                borderRadius: '4px',
                color: 'white',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.3)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.2)';
              }}
            >
              Reconnect Now
            </button>
          )}
        </div>

        {/* Presence awareness - connected users */}
        {connectionStatus === 'connected' && connectedUsers.length > 0 && (
          <div
            className="presence-container"
            onMouseLeave={() => setIsPresenceExpanded(false)}
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              padding: '6px 12px',
              background: 'rgba(255, 255, 255, 0.2)',
              borderRadius: '20px',
              transition: 'all 0.3s ease',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap' }}>
              {connectedUsers.length} {connectedUsers.length === 1 ? 'user' : 'users'}
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', overflow: 'hidden' }}>
              {(isPresenceExpanded ? connectedUsers : connectedUsers.slice(0, MAX_VISIBLE_USERS)).map((user) => (
                <div
                  key={user.id}
                  className="user-avatar"
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: user.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '11px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    border: user.id === USER_ID ? '2px solid white' : '2px solid rgba(255, 255, 255, 0.5)',
                    position: 'relative',
                    flexShrink: 0,
                    transition: 'transform 0.2s ease',
                  }}
                  title={user.name}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.15)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  }}
                >
                  {user.name.charAt(0).toUpperCase()}
                </div>
              ))}
              {!isPresenceExpanded && connectedUsers.length > MAX_VISIBLE_USERS && (
                <div
                  onMouseEnter={() => setIsPresenceExpanded(true)}
                  onMouseLeave={() => setIsPresenceExpanded(false)}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: 'rgba(0, 0, 0, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: '600',
                    border: '2px solid rgba(255, 255, 255, 0.5)',
                    flexShrink: 0,
                    cursor: 'pointer',
                    transition: 'transform 0.2s ease, background 0.2s ease',
                  }}
                  title={`${connectedUsers.length - MAX_VISIBLE_USERS} more users - hover to expand`}
                  onMouseMove={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.15)';
                    (e.currentTarget as HTMLElement).style.background = 'rgba(0, 0, 0, 0.5)';
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    (e.currentTarget as HTMLElement).style.background = 'rgba(0, 0, 0, 0.3)';
                  }}
                >
                  +{connectedUsers.length - MAX_VISIBLE_USERS}
                </div>
              )}
            </div>
          </div>
        )}

        {/* User profile button */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: 'w-8 h-8',
              },
            }}
          />
        </div>
      </div>

      {/* Full-screen tldraw canvas */}
      <div style={{ flex: 1 }}>
        <Tldraw onMount={handleEditorMount} />
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .user-avatar:hover::after {
          content: attr(title);
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 8px;
          padding: 6px 12px;
          background: rgba(0, 0, 0, 0.85);
          color: white;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          border-radius: 6px;
          pointer-events: none;
          z-index: 1001;
        }

        .user-avatar:hover::before {
          content: '';
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 2px;
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-bottom: 6px solid rgba(0, 0, 0, 0.85);
          pointer-events: none;
          z-index: 1001;
        }

        /* Hide unwanted toolbar items */
        button[data-testid="tools.arrow"],
        button[data-testid="tools.asset"],
        button[data-testid="tools.highlight"],
        button[data-testid="toolbar.more"],
        .tlui-toolbar__overflow {
          display: none !important;
        }
      `}</style>
    </div>
  );
}

export default App;
