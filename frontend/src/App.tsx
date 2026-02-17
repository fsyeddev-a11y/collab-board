import { useEffect, useState, useRef } from 'react';
import { Tldraw, InstancePresenceRecordType } from 'tldraw';
import 'tldraw/tldraw.css';

// Generate random user info for testing
const USER_ID = `user-${Math.random().toString(36).substring(7)}`;
const USER_NAME = `User ${Math.floor(Math.random() * 1000)}`;
const USER_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
const USER_COLOR = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

interface ConnectedUser {
  id: string;
  name: string;
  color: string;
}

function App() {
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
  const [isPresenceExpanded, setIsPresenceExpanded] = useState(false);
  const editorRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isRemoteChangeRef = useRef(false);

  // Maximum users to show before showing "+X more"
  const MAX_VISIBLE_USERS = 5;

  // Connect to WebSocket (only once on mount)
  useEffect(() => {
    const boardId = 'default-board';
    const wsUrl = `ws://localhost:8787/board/${boardId}/ws`;

    console.log('[WS] Connecting to:', wsUrl);
    const websocket = new WebSocket(wsUrl);
    wsRef.current = websocket;

    websocket.onopen = () => {
      console.log('[WS] Connected');
      setConnectionStatus('connected');

      // Send initial connect message
      websocket.send(JSON.stringify({
        type: 'connect',
        userId: USER_ID,
        userName: USER_NAME,
        userColor: USER_COLOR,
      }));
    };

    websocket.onclose = (event) => {
      console.log('[WS] Disconnected - Code:', event.code, 'Reason:', event.reason, 'Clean:', event.wasClean);
      setConnectionStatus('disconnected');
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
              message.records.forEach((record: any) => {
                editor.store.put([record]);
              });
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
            if (message.changes.added) {
              Object.values(message.changes.added).forEach((record: any) => {
                editor.store.put([record]);
              });
            }
            if (message.changes.updated) {
              Object.values(message.changes.updated).forEach((record: any) => {
                editor.store.put([record]);
              });
            }
            if (message.changes.removed) {
              Object.keys(message.changes.removed).forEach((id: string) => {
                editor.store.remove([id]);
              });
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

    return () => {
      console.log('[WS] Cleaning up WebSocket');
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
          type: 'disconnect',
          userId: USER_ID,
        }));
      }
      websocket.close();
      wsRef.current = null;
    };
  }, []); // Empty dependency array - only run once

  // Set up editor listener when editor is ready
  const handleEditorMount = (editor: any) => {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
            {connectionStatus === 'disconnected' && 'Disconnected - trying to reconnect...'}
          </span>
        </div>

        {/* Presence awareness - connected users */}
        {connectionStatus === 'connected' && connectedUsers.length > 0 && (
          <div
            className="presence-container"
            onMouseEnter={() => setIsPresenceExpanded(true)}
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
                  }}
                  title={`${connectedUsers.length - MAX_VISIBLE_USERS} more users`}
                >
                  +{connectedUsers.length - MAX_VISIBLE_USERS}
                </div>
              )}
            </div>
          </div>
        )}
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
      `}</style>
    </div>
  );
}

export default App;
