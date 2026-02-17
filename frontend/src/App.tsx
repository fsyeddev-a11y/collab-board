import { useEffect, useState, useRef } from 'react';
import { Tldraw, InstancePresenceRecordType } from 'tldraw';
import { useUser, useAuth, SignIn, UserButton } from '@clerk/clerk-react';
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
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
  const [isPresenceExpanded, setIsPresenceExpanded] = useState(false);
  const editorRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isRemoteChangeRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Maximum users to show before showing "+X more"
  const MAX_VISIBLE_USERS = 5;
  const MAX_RECONNECT_DELAY = 5000; // Max 5 seconds between reconnection attempts

  // Get authenticated user info (only when signed in)
  const USER_ID = isSignedIn && user ? user.id : '';
  const USER_NAME = isSignedIn && user ? (user.fullName || user.username || user.emailAddresses[0]?.emailAddress || 'Anonymous') : '';
  const USER_COLOR = USER_ID ? getUserColor(USER_ID) : '#666';

  // WebSocket connection function
  const connectWebSocket = async () => {
    // Close existing connection if any
    if (wsRef.current) {
      console.log('[WS] Closing existing connection');
      try {
        wsRef.current.close();
      } catch (e) {
        console.warn('[WS] Error closing old connection:', e);
      }
      wsRef.current = null;
    }

    // Get FRESH JWT token BEFORE connecting (important for reconnections)
    console.log('[WS] Getting fresh authentication token...');
    let token: string | null = null;
    try {
      // Force a fresh token by passing { skipCache: true }
      token = await getToken({ skipCache: true });
      if (!token) {
        console.error('[WS] Failed to get authentication token');
        setConnectionStatus('disconnected');
        return;
      }
      console.log('[WS] Fresh token obtained successfully');
    } catch (error) {
      console.error('[WS] Error getting token:', error);
      setConnectionStatus('disconnected');
      return;
    }

    const boardId = 'default-board';
    const wsUrl = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8787';
    const fullWsUrl = `${wsUrl}/board/${boardId}/ws`;

    console.log('[WS] Connecting to:', fullWsUrl);
    setConnectionStatus('connecting');

    const websocket = new WebSocket(fullWsUrl);
    wsRef.current = websocket;

    websocket.onopen = () => {
      console.log('[WS] WebSocket opened');
      setConnectionStatus('connected');
      reconnectAttemptsRef.current = 0; // Reset reconnection attempts

      console.log('[WS] Sending authenticated connect message');

      // Send initial connect message with JWT (already obtained)
      websocket.send(JSON.stringify({
        type: 'connect',
        userId: USER_ID,
        userName: USER_NAME,
        userColor: USER_COLOR,
        token, // Include JWT for backend verification
      }));
    };

    websocket.onclose = (event) => {
      console.log('[WS] Disconnected - Code:', event.code, 'Reason:', event.reason, 'Clean:', event.wasClean);

      // Only set disconnected if this is still the current websocket
      if (wsRef.current === websocket) {
        setConnectionStatus('disconnected');

        // Clear any existing reconnection timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        // Attempt to reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), MAX_RECONNECT_DELAY);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1})...`);

        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          console.log('[WS] Attempting reconnection...');
          connectWebSocket();
        }, delay);
      }
    };

    websocket.onerror = (error) => {
      console.error('[WS] WebSocket Error:', error);
      setConnectionStatus('disconnected');
    };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[WS] Received:', message.type);

        const editor = editorRef.current;
        if (!editor) {
          console.log('[WS] Editor not ready yet, queuing message');
          return;
        }

        // Handle error messages from server
        if (message.type === 'error') {
          console.error('[WS] Server error:', message.message, message.error);
          return;
        }

        // Handle different message types
        if (message.type === 'init' && message.records) {
          // Load initial records from server
          console.log('[WS] Loading initial records:', message.records.length);
          if (message.records.length > 0) {
            // Use mergeRemoteChanges to load initial state without triggering sync
            isRemoteChangeRef.current = true;
            editor.store.mergeRemoteChanges(() => {
              try {
                // Separate records by type - load shapes before bindings
                // This prevents arrow binding errors when the bound shape doesn't exist yet
                const shapes: any[] = [];
                const bindings: any[] = [];
                const others: any[] = [];

                message.records.forEach((record: any) => {
                  if (!record || !record.id || !record.typeName) {
                    console.warn('[WS] Skipping invalid initial record:', record);
                    return;
                  }

                  if (record.typeName === 'binding') {
                    bindings.push(record);
                  } else if (record.typeName === 'shape') {
                    shapes.push(record);
                  } else {
                    others.push(record);
                  }
                });

                // Load in order: others first, then shapes, then bindings
                console.log('[WS] Loading order:', others.length, 'others,', shapes.length, 'shapes,', bindings.length, 'bindings');

                others.forEach((record) => editor.store.put([record]));
                shapes.forEach((record) => editor.store.put([record]));
                bindings.forEach((record) => editor.store.put([record]));
              } catch (error) {
                console.error('[WS] Error loading initial records:', error);
              }
            });
            isRemoteChangeRef.current = false;
            console.log('[WS] Loaded', message.records.length, 'records');
          }

          // Update connected users list (including ourselves)
          if (message.users) {
            setConnectedUsers(message.users);
          }
        } else if (message.type === 'update' && message.changes) {
          // Apply updates from other users
          console.log('[WS] Applying remote changes');

          // Mark as remote change to prevent echo
          isRemoteChangeRef.current = true;

          editor.store.mergeRemoteChanges(() => {
            try {
              // Process added records - shapes before bindings
              if (message.changes.added) {
                const shapes: any[] = [];
                const bindings: any[] = [];
                const others: any[] = [];

                Object.values(message.changes.added).forEach((record: any) => {
                  if (!record || !record.id || !record.typeName) {
                    console.warn('[WS] Skipping invalid added record:', record);
                    return;
                  }

                  if (record.typeName === 'binding') {
                    bindings.push(record);
                  } else if (record.typeName === 'shape') {
                    shapes.push(record);
                  } else {
                    others.push(record);
                  }
                });

                // Load in correct order
                others.forEach((record) => editor.store.put([record]));
                shapes.forEach((record) => editor.store.put([record]));
                bindings.forEach((record) => editor.store.put([record]));
              }

              // Process updated records
              if (message.changes.updated) {
                Object.values(message.changes.updated).forEach((record: any) => {
                  if (record && record.id && record.typeName) {
                    editor.store.put([record]);
                  } else {
                    console.warn('[WS] Skipping invalid updated record:', record);
                  }
                });
              }

              // Process removed records
              if (message.changes.removed) {
                Object.keys(message.changes.removed).forEach((id: string) => {
                  if (id) {
                    editor.store.remove([id]);
                  }
                });
              }
            } catch (error) {
              console.error('[WS] Error applying remote changes:', error);
            }
          });

          // Unmark remote change
          isRemoteChangeRef.current = false;
        } else if (message.type === 'cursor') {
          // Handle cursor updates from other users
          const { userId, userName, userColor, x, y } = message;

          // Don't show our own cursor
          if (userId === USER_ID) return;

          // Create or update presence record for this user
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
            editor.store.put([presence]);
          });
          isRemoteChangeRef.current = false;
        } else if (message.type === 'user-joined') {
          // Add user to connected users list
          const newUser: ConnectedUser = {
            id: message.userId,
            name: message.userName,
            color: message.userColor,
          };
          setConnectedUsers(prev => [...prev, newUser]);

          // Broadcast our current cursor position to help new user see us immediately
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN && editor) {
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
        } else if (message.type === 'user-left') {
          // Remove presence when user leaves
          const presenceId = InstancePresenceRecordType.createId(message.userId);
          isRemoteChangeRef.current = true;
          editor.store.mergeRemoteChanges(() => {
            editor.store.remove([presenceId]);
          });
          isRemoteChangeRef.current = false;

          // Remove user from connected users list
          setConnectedUsers(prev => prev.filter(u => u.id !== message.userId));
        }
      } catch (error) {
        console.error('[WS] Error parsing message:', error);
      }
    };

  };

  // Connect to WebSocket when authenticated
  useEffect(() => {
    // Only connect if user is signed in and has user data
    if (!isSignedIn || !USER_ID) {
      console.log('[WS] Skipping connection - user not authenticated');
      return;
    }

    console.log('[WS] User authenticated, connecting...');
    connectWebSocket();

    return () => {
      console.log('[WS] Cleaning up WebSocket');

      // Clear any pending reconnection attempts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // Close the WebSocket connection
      const ws = wsRef.current;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'disconnect',
            userId: USER_ID,
          }));
        }
        ws.close();
        wsRef.current = null;
      }
    };
  }, [isSignedIn, USER_ID]); // Connect when auth state changes

  // Set up editor listener when editor is ready
  const handleEditorMount = (editor: any) => {
    // Safety check - should never happen but guard against it
    if (!isSignedIn || !USER_ID) {
      console.error('[Tldraw] Editor mount attempted without authentication!');
      return;
    }

    console.log('[Tldraw] Editor mounted');
    editorRef.current = editor;

    // Set user preferences
    editor.user.updateUserPreferences({
      id: USER_ID,
      name: USER_NAME,
      color: USER_COLOR,
    });

    // Listen to local changes and send to server
    const handleChange = (event: any) => {
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
                Object.entries(changes.updated).map(([id, update]: [string, any]) => [id, update[1]])
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
    const CURSOR_THROTTLE_MS = 50; // Send cursor updates at most every 50ms

    const cursorInterval = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      try {
        // Get current cursor position from the editor
        const currentPagePoint = editor.inputs.currentPagePoint;
        const x = currentPagePoint.x;
        const y = currentPagePoint.y;

        // Only send if cursor has moved
        if (x !== lastCursorX || y !== lastCursorY) {
          const now = Date.now();
          if (now - lastCursorUpdate >= CURSOR_THROTTLE_MS) {
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
            {connectionStatus === 'disconnected' && 'Disconnected - reconnecting...'}
          </span>
          {connectionStatus === 'disconnected' && (
            <button
              onClick={() => {
                console.log('[WS] Manual reconnect triggered');
                if (reconnectTimeoutRef.current) {
                  clearTimeout(reconnectTimeoutRef.current);
                }
                reconnectAttemptsRef.current = 0;
                connectWebSocket();
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
