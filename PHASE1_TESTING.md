# Phase 1: Real-Time Sync Testing Guide

## 🚀 Quick Start

### Step 1: Start the Backend (Cloudflare Worker)

Open a terminal and run:

```bash
cd /Users/fsyed/Documents/CollabBoard
npm run dev:backend
```

This will start the Cloudflare Worker with Durable Objects on `http://localhost:8787`.

You should see:
```
⎔ Starting local server...
[wrangler:inf] Ready on http://localhost:8787
```

### Step 2: Start the Frontend (React + Vite)

Open a **second terminal** and run:

```bash
cd /Users/fsyed/Documents/CollabBoard
npm run dev:frontend
```

This will start the Vite dev server on `http://localhost:5173`.

You should see:
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
```

### Step 3: Test Real-Time Sync

1. **Open the first browser window**: Navigate to `http://localhost:5173`
   - You should see a fullscreen tldraw canvas
   - Top status bar shows: "Connected as User XXX" (green background)
   - Console logs show: `[WS] Connected` and `[Tldraw] Editor mounted`

2. **Open the second browser window**: Open `http://localhost:5173` in a new window (or incognito)
   - You'll get a different random username (e.g., "User 789")
   - You'll get a different random color

3. **Test the sync**:
   - ✅ Draw a shape in Window 1 → it appears in Window 2
   - ✅ Draw a shape in Window 2 → it appears in Window 1
   - ✅ Move shapes around → changes sync in real-time
   - ✅ Delete shapes → deletions sync
   - ✅ Add sticky notes → they sync
   - ✅ Move your cursor → both users should see each other's cursors

4. **Test persistence**:
   - Draw some shapes
   - Refresh one of the browsers
   - All shapes should reload from SQLite storage ✅

## 🐛 Debugging

### Check Browser Console
Press `F12` and look for:
- `[WS] Connected`
- `[WS] Sending update:` (when you draw)
- `[WS] Received:` (when other user draws)
- `[Tldraw] Editor mounted`

### Check Backend Logs
In the terminal running the backend, you should see:
- `[BoardRoom] User connected: User XXX`
- `[BoardRoom] Total users: 2`
- `[BoardRoom] Applied update from user-xxx`
- `[BoardRoom] Loaded N records from SQLite`

### Common Issues

**Issue**: Frontend can't connect to WebSocket
- **Fix**: Make sure backend is running on `http://localhost:8787`
- Check that `VITE_API_URL=http://localhost:8787` in `/frontend/.env`

**Issue**: Changes don't sync
- **Fix**: Check both browser consoles for WebSocket errors
- Verify both users are connected (check backend logs)

**Issue**: TypeScript errors
- **Fix**: Run `npm run type-check` in the root directory

## 📊 What's Working

✅ Full-screen tldraw canvas
✅ WebSocket connection to Cloudflare Durable Object
✅ Real-time sync of all tldraw operations (draw, move, delete)
✅ Multi-user cursor tracking
✅ SQLite persistence (shapes survive page refresh)
✅ User presence (see who's connected)
✅ Random user colors/names for testing

## 🎯 Next Steps (Phase 2)

- [ ] Add Clerk authentication
- [ ] Implement AI sticky note generation
- [ ] Add proper user management
- [ ] Create board management UI

---

**Ready to test!** Start both servers and open two browser windows to see real-time collaboration in action! 🎨
