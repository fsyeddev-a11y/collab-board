import { useEffect, useState, useRef } from 'react';
import { Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';

// Generate random user info for testing
const USER_ID = `user-${Math.random().toString(36).substring(7)}`;
const USER_NAME = `User ${Math.floor(Math.random() * 1000)}`;
const USER_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
const USER_COLOR = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

function App() {
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const editorRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isRemoteChangeRef = useRef(false);

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

    // Clean up listener when component unmounts
    return () => {
      console.log('[Tldraw] Cleaning up editor listener');
      unsubscribe();
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
          gap: '8px',
        }}
      >
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

      {/* Full-screen tldraw canvas */}
      <div style={{ flex: 1 }}>
        <Tldraw onMount={handleEditorMount} />
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

export default App;
